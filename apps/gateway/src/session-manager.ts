import {
  MAX_SESSIONS,
  ProtocolErrorCode,
  decodeBase64ToBytes,
  validateTerminalFrame,
  type ConnectFrame,
  type InputFrame,
  type ResizeFrame
} from "@ssh-proxy/protocol";
import { GatewayProtocolError, messageForCode } from "./errors.js";
import type { GatewayLogger } from "./logger.js";
import { SshSession, type SshSessionOptions } from "./ssh-session.js";

export type SessionManagerOptions = SshSessionOptions;

export class SessionManager {
  private readonly sessions = new Map<string, SshSession>();
  private readonly logger: GatewayLogger;
  private readonly options: SessionManagerOptions;

  constructor(logger: GatewayLogger, options: SessionManagerOptions = {}) {
    this.logger = logger;
    this.options = options;
  }

  async createSession(candidateFrame: unknown): Promise<SshSession> {
    const frame = this.validateFrame<ConnectFrame>(candidateFrame, "connect");

    if (this.sessions.size >= MAX_SESSIONS) {
      throw new GatewayProtocolError(ProtocolErrorCode.SshConnectFailed, "Maximum SSH sessions reached");
    }
    if (this.sessions.has(frame.sessionId)) {
      throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, "Session already exists");
    }

    const session = new SshSession(frame, this.logger, this.options);
    session.onClose(() => this.sessions.delete(frame.sessionId));
    this.sessions.set(frame.sessionId, session);

    try {
      await session.open(frame);
      return session;
    } catch (error) {
      this.sessions.delete(frame.sessionId);
      throw error;
    }
  }

  writeInput(candidateFrame: unknown): void {
    const frame = this.validateFrame<InputFrame>(candidateFrame, "input");
    const session = this.requireSession(frame.sessionId);
    session.write(decodeBase64ToBytes(frame.dataBase64));
  }

  resizeSession(candidateFrame: unknown): void {
    const frame = this.validateFrame<ResizeFrame>(candidateFrame, "resize");
    const session = this.requireSession(frame.sessionId);
    session.resize(frame.cols, frame.rows);
  }

  closeSession(sessionId: string, reason = "explicit_close"): void {
    this.requireSession(sessionId).close(reason);
    this.sessions.delete(sessionId);
  }

  closeAll(reason = "shutdown"): void {
    for (const session of this.sessions.values()) {
      session.close(reason);
    }
    this.sessions.clear();
  }

  getSession(sessionId: string): SshSession | undefined {
    return this.sessions.get(sessionId);
  }

  get size(): number {
    return this.sessions.size;
  }

  private requireSession(sessionId: string): SshSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.getState() === "closed") {
      throw new GatewayProtocolError(ProtocolErrorCode.SessionClosed, messageForCode(ProtocolErrorCode.SessionClosed));
    }
    return session;
  }

  private validateFrame<TFrame extends ConnectFrame | InputFrame | ResizeFrame>(candidateFrame: unknown, expectedType: TFrame["type"]): TFrame {
    const result = validateTerminalFrame(candidateFrame);
    if (!result.ok) {
      throw new GatewayProtocolError(result.code, result.message);
    }
    if (result.frame.type !== expectedType) {
      throw new GatewayProtocolError(ProtocolErrorCode.ValidationError, `Expected ${expectedType} frame`);
    }
    return result.frame as TFrame;
  }
}
