import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_POST_BODY_BYTES,
  ProtocolErrorCode,
  encodeBase64,
  validateTerminalFrame,
  type CloseFrame,
  type ConnectFrame,
  type ErrorFrame,
  type InputFrame,
  type OutputFrame,
  type ResizeFrame,
  type TerminalFrame
} from "@ssh-proxy/protocol";
import { GatewayProtocolError, messageForCode, toSanitizedError, type SanitizedGatewayError } from "./errors.js";
import type { GatewayLogger } from "./logger.js";
import type { SessionManager } from "./session-manager.js";

type ClientPostFrame = InputFrame | ResizeFrame | CloseFrame;
type CorsHeaders = Record<string, string>;

const ALLOWED_DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

export interface TerminalHttpOptions {
  heartbeatIntervalMs?: number;
}

export class TerminalHttpFallbackTransport {
  private readonly sessionManager: SessionManager;
  private readonly logger: GatewayLogger;
  private readonly heartbeatIntervalMs: number;

  constructor(sessionManager: SessionManager, logger: GatewayLogger, options: TerminalHttpOptions = {}) {
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  }

  async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const route = parseHttpFallbackRoute(request);
    if (!route) {
      return false;
    }

    try {
      switch (route.kind) {
        case "preflight":
          writePreflight(response, corsHeadersFor(request));
          return true;
        case "create":
          await this.createSession(request, response);
          return true;
        case "events":
          this.openEventStream(route.sessionId, request, response);
          return true;
        case "input":
          await this.handleInput(route.sessionId, request, response);
          return true;
      }
    } catch (error) {
      writeError(response, toSanitizedError(error), undefined, request);
      return true;
    }
  }

  private async createSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const frame = await readJsonFrame<ConnectFrame>(request, "connect");
    const session = await this.sessionManager.createSession(frame);
    writeJson(response, 201, { sessionId: session.sessionId }, corsHeadersFor(request));
  }

  private openEventStream(sessionId: string, request: IncomingMessage, response: ServerResponse): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session || session.getState() === "closed") {
      writeError(response, { code: ProtocolErrorCode.SessionClosed, message: messageForCode(ProtocolErrorCode.SessionClosed) }, 404, request);
      return;
    }

    let sequence = 0;
    let closed = false;
    const nextSeq = () => {
      sequence += 1;
      return sequence;
    };
    const sendFrame = (event: "output" | "error" | "close", frame: OutputFrame | ErrorFrame | CloseFrame) => {
      if (closed || response.destroyed) {
        return;
      }
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(frame)}\n\n`);
    };

    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...corsHeadersFor(request)
    });
    response.flushHeaders();
    response.write(": connected\n\n");
    session.touch();

    const heartbeat = setInterval(() => {
      if (!closed && !response.destroyed) {
        response.write(": ping\n\n");
        session.touch();
      }
    }, this.heartbeatIntervalMs);
    const unsubscribeOutput = session.onOutput((chunk) => {
      sendFrame("output", { type: "output", sessionId, seq: nextSeq(), dataBase64: encodeBase64(chunk.toString("utf8")) });
    });
    const unsubscribeError = session.onError((error) => {
      sendFrame("error", { type: "error", sessionId, seq: nextSeq(), code: error.code, message: messageForCode(error.code) });
    });
    const unsubscribeClose = session.onClose((reason) => {
      sendFrame("close", { type: "close", sessionId, seq: nextSeq(), reason });
      cleanup();
      response.end();
    });
    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(heartbeat);
      unsubscribeOutput();
      unsubscribeError();
      unsubscribeClose();
    };

    request.once("close", cleanup);
    response.once("close", cleanup);
  }

  private async handleInput(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const frame = await readJsonClientPostFrame(request);
    if (frame.sessionId !== sessionId) {
      throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, "Path sessionId does not match frame sessionId");
    }

    switch (frame.type) {
      case "input":
        this.sessionManager.writeInput(frame);
        writeJson(response, 202, { ok: true }, corsHeadersFor(request));
        return;
      case "resize":
        this.sessionManager.resizeSession(frame);
        writeJson(response, 202, { ok: true }, corsHeadersFor(request));
        return;
      case "close":
        this.sessionManager.closeSession(frame.sessionId, frame.reason);
        writeJson(response, 202, { ok: true }, corsHeadersFor(request));
        return;
    }
  }
}

async function readJsonClientPostFrame(request: IncomingMessage): Promise<ClientPostFrame> {
  const result = await readJsonBody(request);
  if (!result.ok) {
    throw new GatewayProtocolError(result.code, result.message);
  }

  const validation = validateTerminalFrame(result.value);
  if (!validation.ok) {
    throw new GatewayProtocolError(validation.code, validation.message);
  }
  if (!isClientPostFrame(validation.frame)) {
    throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, "Expected input, resize, or close frame");
  }
  return validation.frame;
}

async function readJsonFrame<TFrame extends TerminalFrame>(request: IncomingMessage, expectedType: TFrame["type"]): Promise<TFrame> {
  const result = await readJsonBody(request);
  if (!result.ok) {
    throw new GatewayProtocolError(result.code, result.message);
  }

  const validation = validateTerminalFrame(result.value);
  if (!validation.ok) {
    throw new GatewayProtocolError(validation.code, validation.message);
  }
  if (validation.frame.type !== expectedType) {
    throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, `Expected ${expectedType} frame`);
  }
  return validation.frame as TFrame;
}

function readJsonBody(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; code: ProtocolErrorCode; message: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const settle = (result: { ok: true; value: unknown } | { ok: false; code: ProtocolErrorCode; message: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_POST_BODY_BYTES) {
        request.resume();
        settle({ ok: false, code: ProtocolErrorCode.FrameTooLarge, message: "POST body exceeds 8192 bytes" });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        settle({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        settle({ ok: false, code: ProtocolErrorCode.ValidationError, message: "Invalid JSON body" });
      }
    };
    const onError = () => settle({ ok: false, code: ProtocolErrorCode.InternalError, message: "Unable to read request body" });

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
  });
}

function isClientPostFrame(frame: TerminalFrame): frame is ClientPostFrame {
  return frame.type === "input" || frame.type === "resize" || frame.type === "close";
}

function parseHttpFallbackRoute(request: IncomingMessage):
  | { kind: "preflight" }
  | { kind: "create" }
  | { kind: "events"; sessionId: string }
  | { kind: "input"; sessionId: string }
  | undefined {
  if (!request.url) {
    return undefined;
  }
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (request.method === "OPTIONS" && pathname === "/sessions") {
    return { kind: "preflight" };
  }
  if (request.method === "POST" && pathname === "/sessions") {
    return { kind: "create" };
  }

  const match = /^\/sse\/terminal\/([^/]+)\/(events|input)$/.exec(pathname);
  if (!match) {
    return undefined;
  }
  const sessionId = decodeURIComponent(match[1]);
  if (sessionId.length === 0) {
    return undefined;
  }
  if (request.method === "OPTIONS") {
    return { kind: "preflight" };
  }
  if (request.method === "GET" && match[2] === "events") {
    return { kind: "events", sessionId };
  }
  if (request.method === "POST" && match[2] === "input") {
    return { kind: "input", sessionId };
  }
  return undefined;
}

function corsHeadersFor(request: IncomingMessage): CorsHeaders {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !ALLOWED_DEV_ORIGINS.has(origin)) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    vary: "Origin"
  };
}

function writePreflight(response: ServerResponse, corsHeaders: CorsHeaders): void {
  response.writeHead(204, {
    ...corsHeaders,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600"
  });
  response.end();
}

function writeJson(response: ServerResponse, statusCode: number, payload: object, headers: CorsHeaders = {}): void {
  response.writeHead(statusCode, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(payload));
}

function writeError(response: ServerResponse, error: SanitizedGatewayError, overrideStatusCode?: number, request?: IncomingMessage): void {
  if (response.headersSent) {
    return;
  }
  writeJson(response, overrideStatusCode ?? statusForError(error.code), { error: error.code, message: messageForCode(error.code) }, request ? corsHeadersFor(request) : {});
}

function statusForError(code: ProtocolErrorCode): number {
  switch (code) {
    case ProtocolErrorCode.FrameTooLarge:
      return 413;
    case ProtocolErrorCode.SessionClosed:
      return 404;
    case ProtocolErrorCode.ValidationError:
      return 400;
    case ProtocolErrorCode.SshAuthFailed:
      return 401;
    case ProtocolErrorCode.SshTimeout:
    case ProtocolErrorCode.SshConnectFailed:
      return 502;
    case ProtocolErrorCode.InternalError:
      return 500;
  }
}
