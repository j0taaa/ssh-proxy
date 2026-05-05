import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { decodeBase64, encodeBase64, type ConnectFrame, type InputFrame, type ResizeFrame, type TerminalFrame } from "@ssh-proxy/protocol";
import { createGatewayServer } from "../server.js";
import type { GatewayLogFields, GatewayLogger } from "../logger.js";
import type { GatewayServerOptions } from "../server.js";

export interface MemoryLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  fields?: GatewayLogFields;
}

export class MemoryLogger implements GatewayLogger {
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

export interface RunningGateway {
  url: string;
  wsUrl: string;
  logger: MemoryLogger;
  size(): number;
  close(): Promise<void>;
}

export async function startGateway(options: Partial<GatewayServerOptions> = {}): Promise<RunningGateway> {
  const logger = options.logger instanceof MemoryLogger ? options.logger : new MemoryLogger();
  const { server, sessionManager } = createGatewayServer({
    ...options,
    logger,
    httpFallbackOptions: { heartbeatIntervalMs: 100, ...options.httpFallbackOptions },
    webSocketOptions: { heartbeatIntervalMs: 25_000, ...options.webSocketOptions }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    wsUrl: `ws://127.0.0.1:${address.port}/ws/terminal`,
    logger,
    size: () => sessionManager.size,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

export function connectFrame(sessionId: string, port: number, options: Partial<ConnectFrame> = {}): ConnectFrame {
  return {
    type: "connect",
    sessionId,
    seq: 1,
    host: "127.0.0.1",
    port,
    username: "testuser",
    password: "testpass",
    cols: 80,
    rows: 24,
    ...options
  };
}

export function inputFrame(sessionId: string, value: string, seq = 2): InputFrame {
  return { type: "input", sessionId, seq, dataBase64: encodeBase64(value) };
}

export function resizeFrame(sessionId: string, cols: number, rows: number, seq = 3): ResizeFrame {
  return { type: "resize", sessionId, seq, cols, rows };
}

export async function waitForSessionOutput(session: { onOutput(listener: (chunk: Buffer) => void): () => void }, expected: string): Promise<string> {
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

export function onceSessionClose(session: { onClose(listener: (reason: string) => void): () => void }): Promise<string> {
  return new Promise((resolve) => {
    const unsubscribe = session.onClose((reason) => {
      unsubscribe();
      resolve(reason);
    });
  });
}

export function isTerminalFrame(value: unknown): value is TerminalFrame {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

export function outputText(frame: Extract<TerminalFrame, { type: "output" }>): string {
  return decodeBase64(frame.dataBase64);
}
