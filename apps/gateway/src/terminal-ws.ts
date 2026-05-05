import { URL } from "node:url";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  HEARTBEAT_INTERVAL_MS,
  ProtocolErrorCode,
  encodeBase64,
  validateTerminalFrame,
  type CloseFrame,
  type ConnectAckFrame,
  type ConnectFrame,
  type ErrorFrame,
  type InputFrame,
  type PingFrame,
  type PongFrame,
  type ResizeFrame,
  type TerminalFrame
} from "@ssh-proxy/protocol";
import { GatewayProtocolError, messageForCode, toSanitizedError, type SanitizedGatewayError } from "./errors.js";
import type { GatewayLogger } from "./logger.js";
import type { SessionManager } from "./session-manager.js";

const TERMINAL_WS_PATH = "/ws/terminal";

type ClientFrame = ConnectFrame | InputFrame | ResizeFrame | CloseFrame | PingFrame | PongFrame;
type TimerHandle = ReturnType<typeof setInterval>;

export interface TerminalWebSocketOptions {
  heartbeatIntervalMs?: number;
}

export interface TerminalWebSocketTransport {
  close(): void;
}

export function attachTerminalWebSocketTransport(
  server: Server,
  sessionManager: SessionManager,
  logger: GatewayLogger,
  options: TerminalWebSocketOptions = {}
): TerminalWebSocketTransport {
  const wss = new WebSocketServer({ noServer: true });
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const clients = new Set<WebSocket>();

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!isTerminalWebSocketPath(request)) {
      rejectUpgrade(socket);
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  };

  wss.on("connection", (webSocket) => {
    clients.add(webSocket);
    new TerminalWebSocketConnection(webSocket, sessionManager, logger, heartbeatIntervalMs).start();
    webSocket.once("close", () => clients.delete(webSocket));
  });
  server.on("upgrade", onUpgrade);

  return {
    close() {
      server.off("upgrade", onUpgrade);
      for (const client of clients) {
        client.terminate();
      }
      wss.close();
    }
  };
}

class TerminalWebSocketConnection {
  private readonly webSocket: WebSocket;
  private readonly sessionManager: SessionManager;
  private readonly logger: GatewayLogger;
  private readonly heartbeatIntervalMs: number;
  private sessionId: string | undefined;
  private sequence = 0;
  private alive = true;
  private heartbeatTimer: TimerHandle | undefined;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(webSocket: WebSocket, sessionManager: SessionManager, logger: GatewayLogger, heartbeatIntervalMs: number) {
    this.webSocket = webSocket;
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  start(): void {
    this.webSocket.on("message", (data, isBinary) => void this.handleMessage(data, isBinary));
    this.webSocket.on("pong", () => this.markAlive());
    this.webSocket.on("error", (error) => {
      this.logger.warn("Terminal WebSocket error", { reason: toSanitizedError(error).code });
    });
    this.webSocket.once("close", () => this.cleanup("websocket_close"));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
  }

  private async handleMessage(data: RawData, isBinary: boolean): Promise<void> {
    this.markAlive();

    if (isBinary) {
      this.sendError({ code: ProtocolErrorCode.ValidationError, message: messageForCode(ProtocolErrorCode.ValidationError) });
      return;
    }

    const frameResult = parseClientFrame(data);
    if (!frameResult.ok) {
      this.sendError(frameResult.error);
      return;
    }

    const frame = frameResult.frame;
    this.sessionId = this.sessionId ?? frame.sessionId;

    try {
      switch (frame.type) {
        case "connect":
          await this.connect(frame);
          return;
        case "input":
          this.sessionManager.writeInput(frame);
          return;
        case "resize":
          this.sessionManager.resizeSession(frame);
          return;
        case "close":
          this.closeSession(frame.reason);
          this.closeWebSocket(1000, "session_close");
          return;
        case "ping":
          this.sendFrame({ type: "pong", sessionId: frame.sessionId, seq: this.nextSeq() });
          return;
        case "pong":
          this.markAlive();
          return;
      }
    } catch (error) {
      this.sendError(toSanitizedError(error));
    }
  }

  private async connect(frame: ConnectFrame): Promise<void> {
    if (this.sessionId && this.sessionManager.getSession(this.sessionId)) {
      throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, "WebSocket already has an SSH session");
    }
    if (this.sessionManager.getSession(frame.sessionId)) {
      throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, "Session already exists");
    }

    const session = await this.sessionManager.createSession(frame);
    this.sessionId = frame.sessionId;
    this.unsubscribers.push(
      session.onOutput((chunk) => {
        this.sendFrame({ type: "output", sessionId: frame.sessionId, seq: this.nextSeq(), dataBase64: encodeBase64(chunk.toString("utf8")) });
      }),
      session.onError((error) => this.sendError(error)),
      session.onClose((reason) => {
        this.sendFrame({ type: "close", sessionId: frame.sessionId, seq: this.nextSeq(), reason });
        this.closeWebSocket(1000, "session_close");
      })
    );
    this.sendFrame({ type: "connect_ack", sessionId: frame.sessionId, seq: this.nextSeq() });
  }

  private heartbeat(): void {
    if (this.webSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.alive) {
      this.cleanup("heartbeat_timeout");
      this.webSocket.terminate();
      return;
    }

    this.alive = false;
    this.webSocket.ping();
    this.sendFrame({ type: "ping", sessionId: this.sessionId ?? "heartbeat", seq: this.nextSeq() });
  }

  private markAlive(): void {
    this.alive = true;
    if (this.sessionId) {
      this.sessionManager.getSession(this.sessionId)?.touch();
    }
  }

  private sendError(error: SanitizedGatewayError): void {
    this.sendFrame({
      type: "error",
      sessionId: this.sessionId ?? "unknown",
      seq: this.nextSeq(),
      code: error.code,
      message: messageForCode(error.code)
    });
  }

  private sendFrame(frame: ConnectAckFrame | ErrorFrame | CloseFrame | PingFrame | PongFrame | Extract<TerminalFrame, { type: "output" }>): void {
    if (this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(frame));
    }
  }

  private closeSession(reason: string): void {
    if (this.sessionId && this.sessionManager.getSession(this.sessionId)) {
      this.sessionManager.closeSession(this.sessionId, reason);
    }
  }

  private closeWebSocket(code: number, reason: string): void {
    if (this.webSocket.readyState === WebSocket.OPEN || this.webSocket.readyState === WebSocket.CONNECTING) {
      this.webSocket.close(code, reason);
    }
  }

  private cleanup(reason: string): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    while (this.unsubscribers.length > 0) {
      this.unsubscribers.pop()?.();
    }
    this.closeSession(reason);
  }

  private nextSeq(): number {
    this.sequence += 1;
    return this.sequence;
  }
}

function parseClientFrame(data: RawData): { ok: true; frame: ClientFrame } | { ok: false; error: SanitizedGatewayError } {
  try {
    const result = validateTerminalFrame(JSON.parse(rawDataToText(data)));
    if (!result.ok) {
      return { ok: false, error: { code: result.code, message: result.message } };
    }
    if (!isClientFrame(result.frame)) {
      return { ok: false, error: { code: ProtocolErrorCode.ValidationError, message: messageForCode(ProtocolErrorCode.ValidationError) } };
    }
    return { ok: true, frame: result.frame };
  } catch (error) {
    return { ok: false, error: toSanitizedError(new GatewayProtocolError(ProtocolErrorCode.ValidationError, String(error))) };
  }
}

function rawDataToText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof Buffer) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

function isClientFrame(frame: TerminalFrame): frame is ClientFrame {
  return frame.type === "connect" || frame.type === "input" || frame.type === "resize" || frame.type === "close" || frame.type === "ping" || frame.type === "pong";
}

function isTerminalWebSocketPath(request: IncomingMessage): boolean {
  if (!request.url) {
    return false;
  }
  return new URL(request.url, "http://localhost").pathname === TERMINAL_WS_PATH;
}

function rejectUpgrade(socket: Socket): void {
  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
}
