import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Server, utils, type AuthContext, type Connection, type ServerChannel, type Session, type WindowChangeInfo } from "ssh2";
import { ProtocolErrorCode, encodeBase64, type ConnectFrame, type InputFrame, type ResizeFrame } from "@ssh-proxy/protocol";
import { toSanitizedError } from "./errors.js";
import type { GatewayLogFields, GatewayLogger } from "./logger.js";
import { SessionManager } from "./session-manager.js";

interface MemoryLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  fields?: GatewayLogFields;
}

interface MockSshServer {
  port: number;
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
  close(): Promise<void>;
}

class MemoryLogger implements GatewayLogger {
  readonly entries: MemoryLogEntry[] = [];

  info(message: string, fields?: GatewayLogFields): void {
    this.entries.push({ level: "info", message, fields });
  }

  warn(message: string, fields?: GatewayLogFields): void {
    this.entries.push({ level: "warn", message, fields });
  }

  error(message: string, fields?: GatewayLogFields): void {
    this.entries.push({ level: "error", message, fields });
  }

  text(): string {
    return JSON.stringify(this.entries);
  }
}

describe("SessionManager SSH core", () => {
  it("opens a password SSH PTY shell, writes input, resizes, and closes explicitly", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);
    const sessionId = "happy-session";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port, "testpass"));
      const outputPromise = waitForOutput(session, "ok");

      manager.writeInput(inputFrame(sessionId, "echo ok\n"));
      manager.resizeSession(resizeFrame(sessionId, 100, 40));

      await expect(outputPromise).resolves.toContain("ok");
      await waitForResize(sshServer, 100, 40);
      expect(sshServer.inputs).toContain("echo ok\n");
      expect(sshServer.resizes).toContainEqual({ cols: 100, rows: 40 });

      manager.closeSession(sessionId, "test_close");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("rejects bad passwords with sanitized auth failure and redacted logs", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);

    try {
      await expect(manager.createSession(connectFrame("bad-auth-session", sshServer.port, "wrongpass"))).rejects.toMatchObject({
        code: ProtocolErrorCode.SshAuthFailed
      });

      const logs = logger.text();
      expect(logs).not.toContain("wrongpass");
      expect(logs).not.toContain("testpass");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("removes sessions when the SSH channel closes", async () => {
    const sshServer = await startMockSshServer({ closeOnInput: "exit\n" });
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);
    const sessionId = "channel-close-session";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port, "testpass"));
      const closed = onceClose(session);
      manager.writeInput(inputFrame(sessionId, "exit\n"));

      await expect(closed).resolves.toBe("channel_close");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("removes idle sessions after the configured timeout", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger, { idleTimeoutMs: 1_000 });
    const sessionId = "idle-session";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port, "testpass"));
      const closed = onceClose(session);

      await expect(closed).resolves.toBe("idle_timeout");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("validates connect and resize frames before touching SSH state", async () => {
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);

    await expect(manager.createSession({ type: "connect", sessionId: "invalid", seq: 0 })).rejects.toMatchObject({
      code: ProtocolErrorCode.ValidationError
    });
    expect(() => manager.resizeSession(resizeFrame("missing", 10, 40))).toThrow("Invalid resize cols");
    expect(manager.size).toBe(0);
  });

  it("maps unknown non-Error failures to sanitized internal errors", () => {
    expect(toSanitizedError("boom")).toEqual({
      code: ProtocolErrorCode.InternalError,
      message: "Internal gateway error."
    });
  });
});

function connectFrame(sessionId: string, port: number, password: string): ConnectFrame {
  return {
    type: "connect",
    sessionId,
    seq: 1,
    host: "127.0.0.1",
    port,
    username: "testuser",
    password,
    cols: 80,
    rows: 24
  };
}

function inputFrame(sessionId: string, value: string): InputFrame {
  return { type: "input", sessionId, seq: 2, dataBase64: encodeBase64(value) };
}

function resizeFrame(sessionId: string, cols: number, rows: number): ResizeFrame {
  return { type: "resize", sessionId, seq: 3, cols, rows };
}

async function waitForOutput(session: { onOutput(listener: (chunk: Buffer) => void): () => void }, expected: string): Promise<string> {
  let received = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Expected output ${expected}`));
    }, 2_000);
    const unsubscribe = session.onOutput((chunk) => {
      received += chunk.toString("utf8");
      if (received.includes(expected)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(received);
      }
    });
  });
}

function onceClose(session: { onClose(listener: (reason: string) => void): () => void }): Promise<string> {
  return new Promise((resolve) => {
    const unsubscribe = session.onClose((reason) => {
      unsubscribe();
      resolve(reason);
    });
  });
}

async function startMockSshServer(options: { closeOnInput?: string } = {}): Promise<MockSshServer> {
  const hostKey = utils.generateKeyPairSync("ed25519").private;
  const inputs: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const clients: Connection[] = [];
  const server = new Server({ hostKeys: [hostKey] });

  server.on("connection", (client) => {
    clients.push(client);
    client.on("authentication", (context: AuthContext) => {
      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
        context.accept();
        return;
      }
      context.reject(["password"]);
    });

    client.on("ready", () => {
      client.on("session", (accept, reject) => {
        const session = accept();
        wireSession(session, inputs, resizes, options, reject);
      });
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    inputs,
    resizes,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of clients) {
          client.end();
        }
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

function wireSession(
  session: Session,
  inputs: string[],
  resizes: Array<{ cols: number; rows: number }>,
  options: { closeOnInput?: string },
  rejectSession: () => void
): void {
  session.on("pty", (accept, reject, info) => {
    if (info.cols >= 20 && info.rows >= 5) {
      accept();
      return;
    }
    reject();
  });
  session.on("window-change", (_accept, _reject, info) => {
    if (isWindowChangeInfo(info) && info.cols >= 20 && info.rows >= 5) {
      resizes.push({ cols: info.cols, rows: info.rows });
    }
  });
  session.on("shell", (accept) => {
    const channel = accept();
    wireShell(channel, inputs, options);
  });
  session.on("exec", () => rejectSession());
}

async function waitForResize(sshServer: MockSshServer, cols: number, rows: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (sshServer.resizes.some((resize) => resize.cols === cols && resize.rows === rows)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected resize ${cols}x${rows}`);
}

function isWindowChangeInfo(value: unknown): value is WindowChangeInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "cols" in value &&
    "rows" in value &&
    typeof value.cols === "number" &&
    typeof value.rows === "number"
  );
}

function wireShell(channel: ServerChannel, inputs: string[], options: { closeOnInput?: string }): void {
  channel.write("mock-shell-ready\n");
  channel.on("end", () => channel.close());
  channel.on("data", (chunk: Buffer) => {
    const input = chunk.toString("utf8");
    inputs.push(input);
    if (input === options.closeOnInput) {
      channel.close();
      return;
    }
    if (input.includes("echo ok")) {
      channel.write("ok\n");
    }
  });
}
