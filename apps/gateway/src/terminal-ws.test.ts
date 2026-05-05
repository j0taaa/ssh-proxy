import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { Server, utils, type AuthContext, type Connection, type ServerChannel, type Session, type WindowChangeInfo } from "ssh2";
import { ProtocolErrorCode, decodeBase64, encodeBase64, type ConnectFrame, type TerminalFrame } from "@ssh-proxy/protocol";
import { createGatewayServer } from "./server.js";
import type { GatewayLogFields, GatewayLogger } from "./logger.js";

interface MockSshServer {
  port: number;
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
  shellReadyCount: number;
  close(): Promise<void>;
}

interface RunningGateway {
  url: string;
  close(): Promise<void>;
}

interface MemoryLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  fields?: GatewayLogFields;
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
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    await cleanupTasks.shift()?.();
  }
});

describe("terminal WebSocket transport", () => {
  it("sends connect_ack after shell readiness and forwards input/output roundtrip", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.url);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-roundtrip", sshServer.port)));

    const ack = await waitForFrame(webSocket, "connect_ack");
    expect(ack.sessionId).toBe("wss-roundtrip");
    expect(sshServer.shellReadyCount).toBe(1);

    webSocket.send(JSON.stringify({ type: "input", sessionId: "wss-roundtrip", seq: 2, dataBase64: encodeBase64("printf wss-ok\n") }));

    const output = await waitForOutputText(webSocket, "wss-ok");
    expect(output).toContain("wss-ok");
    expect(sshServer.inputs.some((input) => input === "printf wss-ok\n")).toBe(true);
  });

  it("delivers resize frames to the active SSH PTY", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.url);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-resize", sshServer.port)));
    await waitForFrame(webSocket, "connect_ack");

    webSocket.send(JSON.stringify({ type: "resize", sessionId: "wss-resize", seq: 2, cols: 120, rows: 36 }));

    await expect(waitForResize(sshServer, 120, 36)).resolves.toBeUndefined();
  });

  it("rejects invalid JSON protocol frames with sanitized validation errors", async () => {
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.url);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close);

    webSocket.send(JSON.stringify({ type: "input", sessionId: "bad-frame", seq: 1, dataBase64: "not-base64***" }));

    const error = await waitForFrame(webSocket, "error");
    expect(error).toMatchObject({ code: ProtocolErrorCode.ValidationError, message: "Invalid terminal frame." });
  });

  it("keeps an active socket open across heartbeat ping/pong checks", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway(100);
    const webSocket = await openWebSocket(gateway.url);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-heartbeat", sshServer.port)));
    await waitForFrame(webSocket, "connect_ack");
    await waitForFrame(webSocket, "ping", 1_000);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(webSocket.readyState).toBe(WebSocket.OPEN);
  });
});

function connectFrame(sessionId: string, port: number): ConnectFrame {
  return {
    type: "connect",
    sessionId,
    seq: 1,
    host: "127.0.0.1",
    port,
    username: "testuser",
    password: "testpass",
    cols: 80,
    rows: 24
  };
}

async function startGateway(heartbeatIntervalMs = 25_000): Promise<RunningGateway> {
  const logger = new MemoryLogger();
  const { server } = createGatewayServer({ logger, webSocketOptions: { heartbeatIntervalMs } });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${address.port}/ws/terminal`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const webSocket = new WebSocket(url);
  await once(webSocket, "open");
  return webSocket;
}

function closeWebSocket(webSocket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (webSocket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    webSocket.once("close", () => resolve());
    webSocket.close();
    setTimeout(() => {
      if (webSocket.readyState !== WebSocket.CLOSED) {
        webSocket.terminate();
      }
      resolve();
    }, 250);
  });
}

async function waitForFrame<TType extends TerminalFrame["type"]>(webSocket: WebSocket, type: TType, timeoutMs = 2_000): Promise<Extract<TerminalFrame, { type: TType }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      webSocket.off("message", onMessage);
      reject(new Error(`Expected ${type} frame`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString("utf8")) as unknown;
      if (isTerminalFrame(frame) && frame.type === type) {
        clearTimeout(timeout);
        webSocket.off("message", onMessage);
        resolve(frame as Extract<TerminalFrame, { type: TType }>);
      }
    };
    webSocket.on("message", onMessage);
  });
}

async function waitForOutputText(webSocket: WebSocket, expected: string): Promise<string> {
  let received = "";
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const output = await waitForFrame(webSocket, "output", Math.max(1, deadline - Date.now()));
    received += decodeBase64(output.dataBase64);
    if (received.includes(expected)) {
      return received;
    }
  }
  throw new Error(`Expected output ${expected}`);
}

function isTerminalFrame(value: unknown): value is TerminalFrame {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

async function startMockSshServer(): Promise<MockSshServer> {
  const hostKey = utils.generateKeyPairSync("ed25519").private;
  const inputs: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const clients: Connection[] = [];
  const server = new Server({ hostKeys: [hostKey] });
  let shellReadyCount = 0;

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
        wireSession(session, inputs, resizes, () => {
          shellReadyCount += 1;
        }, reject);
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
    get shellReadyCount() {
      return shellReadyCount;
    },
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
  onShellReady: () => void,
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
    onShellReady();
    wireShell(channel, inputs);
  });
  session.on("exec", () => rejectSession());
}

function wireShell(channel: ServerChannel, inputs: string[]): void {
  channel.write("mock-shell-ready\n");
  channel.on("end", () => channel.close());
  channel.on("data", (chunk: Buffer) => {
    const input = chunk.toString("utf8");
    inputs.push(input);
    if (input.includes("printf wss-ok")) {
      channel.write("wss-ok\n");
    }
  });
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
