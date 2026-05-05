import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
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
  size(): number;
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

describe("terminal HTTP SSE/POST fallback transport", () => {
  it("creates a session, streams output over SSE, and sends input over POST", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-roundtrip";
    const createResponse = await postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port));
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual({ sessionId });
    expect(sshServer.shellReadyCount).toBe(1);

    const sseClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    cleanupTasks.unshift(() => sseClient.close());

    const inputResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      type: "input",
      sessionId,
      seq: 2,
      dataBase64: encodeBase64("printf http-ok\n")
    });
    expect(inputResponse.status).toBe(202);

    const output = await waitForOutputText(sseClient, "http-ok");
    expect(output).toContain("http-ok");
    expect(sshServer.inputs).toContain("printf http-ok\n");
  });

  it("allows dev browser CORS preflight, POST, and SSE from the web origin", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const origin = "http://127.0.0.1:3000";
    const sessionId = "http-cors";
    const preflightResponse = await fetch(`${gateway.url}/sessions`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });
    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflightResponse.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflightResponse.headers.get("access-control-allow-headers")).toContain("content-type");

    const createResponse = await postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port), { origin });
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("access-control-allow-origin")).toBe(origin);

    const sseClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`, { origin });
    cleanupTasks.unshift(() => sseClient.close());
    expect(sseClient.allowOrigin).toBe(origin);

    const inputResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      type: "input",
      sessionId,
      seq: 2,
      dataBase64: encodeBase64("printf http-ok\n")
    }, { origin });
    expect(inputResponse.status).toBe(202);
    expect(inputResponse.headers.get("access-control-allow-origin")).toBe(origin);
    await expect(waitForOutputText(sseClient, "http-ok")).resolves.toContain("http-ok");
  });

  it("delivers POST resize frames to the active SSH PTY", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-resize";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });

    const resizeResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, { type: "resize", sessionId, seq: 2, cols: 132, rows: 43 });
    expect(resizeResponse.status).toBe(202);
    await expect(waitForResize(sshServer, 132, 43)).resolves.toBeUndefined();
  });

  it("rejects oversized POST bodies and decoded data frames without writing to SSH", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-oversize";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });

    const oversizedDecoded = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      type: "input",
      sessionId,
      seq: 2,
      dataBase64: Buffer.alloc(4097, "x").toString("base64")
    });
    expect(oversizedDecoded.status).toBe(413);
    expect(await oversizedDecoded.json()).toEqual({ error: ProtocolErrorCode.FrameTooLarge, message: "Terminal frame is too large." });

    const oversizedBody = await fetch(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "input", sessionId, seq: 3, dataBase64: "" }).padEnd(8193, " ")
    });
    expect(oversizedBody.status).toBe(413);
    expect(sshServer.inputs).toEqual([]);
  });

  it("allows SSE reconnect to the same active in-memory session", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-reconnect";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });

    const firstClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    await firstClient.close();
    expect(gateway.size()).toBe(1);

    const secondClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    cleanupTasks.unshift(() => secondClient.close());
    const inputResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      type: "input",
      sessionId,
      seq: 2,
      dataBase64: encodeBase64("printf reconnect-ok\n")
    });
    expect(inputResponse.status).toBe(202);

    const output = await waitForOutputText(secondClient, "reconnect-ok");
    expect(output).toContain("reconnect-ok");
    expect(gateway.size()).toBe(1);
  });

  it("explicit close POST closes SSH and removes the managed session", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-close";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });
    expect(gateway.size()).toBe(1);

    const closeResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, { type: "close", sessionId, seq: 2, reason: "test_close" });
    expect(closeResponse.status).toBe(202);
    expect(gateway.size()).toBe(0);
  });
});

class SseClient {
  private readonly response: Response;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly pendingBlocks: string[] = [];
  private buffer = "";

  private constructor(response: Response, reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.response = response;
    this.reader = reader;
  }

  get allowOrigin(): string | null {
    return this.response.headers.get("access-control-allow-origin");
  }

  static async open(url: string, headers?: HeadersInit): Promise<SseClient> {
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    if (!response.body) {
      throw new Error("Expected SSE response body");
    }
    return new SseClient(response, response.body.getReader());
  }

  async waitForFrame<TType extends TerminalFrame["type"]>(type: TType, timeoutMs = 2_000): Promise<Extract<TerminalFrame, { type: TType }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = this.shiftFrame(type);
      if (frame) {
        return frame;
      }
      const readTimeoutMs = Math.max(1, deadline - Date.now());
      const readResult = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => setTimeout(() => reject(new Error(`Expected ${type} SSE frame`)), readTimeoutMs))
      ]);
      if (readResult.done) {
        break;
      }
      this.buffer += this.decoder.decode(readResult.value, { stream: true });
      this.extractBlocks();
    }
    throw new Error(`Expected ${type} SSE frame`);
  }

  async close(): Promise<void> {
    await this.reader.cancel();
    await this.response.body?.cancel().catch(() => undefined);
  }

  private extractBlocks(): void {
    let delimiterIndex = this.buffer.indexOf("\n\n");
    while (delimiterIndex >= 0) {
      this.pendingBlocks.push(this.buffer.slice(0, delimiterIndex));
      this.buffer = this.buffer.slice(delimiterIndex + 2);
      delimiterIndex = this.buffer.indexOf("\n\n");
    }
  }

  private shiftFrame<TType extends TerminalFrame["type"]>(type: TType): Extract<TerminalFrame, { type: TType }> | undefined {
    while (this.pendingBlocks.length > 0) {
      const block = this.pendingBlocks.shift();
      if (!block || block.startsWith(":")) {
        continue;
      }
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) {
        continue;
      }
      const frame = JSON.parse(dataLine.slice("data: ".length)) as unknown;
      if (isTerminalFrame(frame) && frame.type === type) {
        return frame as Extract<TerminalFrame, { type: TType }>;
      }
    }
    return undefined;
  }
}

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

async function startGateway(): Promise<RunningGateway> {
  const logger = new MemoryLogger();
  const { server, sessionManager } = createGatewayServer({ logger, httpFallbackOptions: { heartbeatIntervalMs: 100 } });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    size: () => sessionManager.size,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function postJson(url: string, body: object, headers: HeadersInit = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

async function waitForOutputText(sseClient: SseClient, expected: string): Promise<string> {
  let received = "";
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const output = await sseClient.waitForFrame("output", Math.max(1, deadline - Date.now()));
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
    if (input.includes("printf http-ok")) {
      channel.write("http-ok\n");
    }
    if (input.includes("printf reconnect-ok")) {
      channel.write("reconnect-ok\n");
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
