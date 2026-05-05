import { EventEmitter } from "node:events";
import { Client, type ClientChannel } from "ssh2";
import {
  HEARTBEAT_INTERVAL_MS,
  IDLE_TIMEOUT_MS,
  MAX_SESSION_DURATION_MS,
  ProtocolErrorCode,
  SSH_CONNECT_TIMEOUT_MS,
  type ConnectFrame
} from "@ssh-proxy/protocol";
import { GatewayProtocolError, toSanitizedError, type SanitizedGatewayError } from "./errors.js";
import type { GatewayLogger } from "./logger.js";

type TimeoutHandle = ReturnType<typeof setTimeout>;

interface SshSessionEvents {
  output: [Buffer];
  close: [string];
  error: [SanitizedGatewayError];
}

export type SshSessionState = "connecting" | "open" | "closed";

export interface SshSessionOptions {
  idleTimeoutMs?: number;
  maxDurationMs?: number;
}

export class SshSession {
  readonly sessionId: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;

  private readonly client: Client;
  private readonly events = new EventEmitter<SshSessionEvents>();
  private readonly logger: GatewayLogger;
  private state: SshSessionState = "connecting";
  private channel: ClientChannel | undefined;
  private idleTimer: TimeoutHandle | undefined;
  private durationTimer: TimeoutHandle | undefined;
  private closeReason = "closed";
  private readonly idleTimeoutMs: number;
  private readonly maxDurationMs: number;

  constructor(frame: ConnectFrame, logger: GatewayLogger, options: SshSessionOptions = {}) {
    this.sessionId = frame.sessionId;
    this.host = frame.host;
    this.port = frame.port;
    this.username = frame.username;
    this.logger = logger;
    this.client = new Client();
    this.events.on("error", () => undefined);
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.maxDurationMs = options.maxDurationMs ?? MAX_SESSION_DURATION_MS;
  }

  onOutput(listener: (chunk: Buffer) => void): () => void {
    this.events.on("output", listener);
    return () => this.events.off("output", listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.events.on("close", listener);
    return () => this.events.off("close", listener);
  }

  onError(listener: (error: SanitizedGatewayError) => void): () => void {
    this.events.on("error", listener);
    return () => this.events.off("error", listener);
  }

  async open(frame: ConnectFrame): Promise<void> {
    if (this.state !== "connecting") {
      throw new GatewayProtocolError(ProtocolErrorCode.SessionClosed, "Session already used");
    }

    this.registerClientEvents();
    this.armTimers();

    try {
      await this.connect(frame);
      await this.openShell(frame);
      this.state = "open";
      this.touch();
      this.logger.info("SSH shell opened", this.safeFields());
    } catch (error) {
      const sanitized = toSanitizedError(error);
      this.events.emit("error", sanitized);
      this.close(sanitized.code);
      throw new GatewayProtocolError(sanitized.code, sanitized.message);
    }
  }

  write(data: Uint8Array): void {
    if (this.state !== "open" || !this.channel) {
      throw new GatewayProtocolError(ProtocolErrorCode.SessionClosed, "Session is closed");
    }
    this.touch();
    this.channel.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.state !== "open" || !this.channel) {
      throw new GatewayProtocolError(ProtocolErrorCode.SessionClosed, "Session is closed");
    }
    this.channel.setWindow(rows, cols, 0, 0);
    this.touch();
    this.logger.info("SSH shell resized", { ...this.safeFields(), reason: `${cols}x${rows}` });
  }

  close(reason = "closed"): void {
    if (this.state === "closed") {
      return;
    }

    this.state = "closed";
    this.closeReason = reason;
    this.clearTimers();

    if (this.channel && !this.channel.destroyed) {
      this.channel.end();
      this.channel.destroy();
    }
    this.client.end();
    this.events.emit("close", reason);
    this.events.removeAllListeners();
    this.logger.info("SSH session closed", { ...this.safeFields(), reason });
  }

  getState(): SshSessionState {
    return this.state;
  }

  touch(): void {
    if (this.state === "closed") {
      return;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.events.emit("error", { code: ProtocolErrorCode.SessionClosed, message: "SSH session is closed." });
      this.close("idle_timeout");
    }, this.idleTimeoutMs);
  }

  private connect(frame: ConnectFrame): Promise<void> {
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const timeout = () => fail(new GatewayProtocolError(ProtocolErrorCode.SshTimeout, "SSH connection timed out"));
      const cleanup = () => {
        this.client.off("ready", ready);
        this.client.off("error", fail);
        this.client.off("timeout", timeout);
      };

      this.client.once("ready", ready);
      this.client.once("error", fail);
      this.client.once("timeout", timeout);
      this.client.connect({
        host: frame.host,
        port: frame.port,
        username: frame.username,
        password: frame.password,
        readyTimeout: SSH_CONNECT_TIMEOUT_MS,
        keepaliveInterval: HEARTBEAT_INTERVAL_MS,
        keepaliveCountMax: 3
      });
    });
  }

  private openShell(frame: ConnectFrame): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.shell({ cols: frame.cols, rows: frame.rows, term: "xterm-256color" }, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        this.channel = channel;
        channel.on("data", (chunk: Buffer) => {
          this.touch();
          this.events.emit("output", Buffer.from(chunk));
        });
        channel.once("close", () => this.close("channel_close"));
        channel.once("error", (channelError: Error) => {
          const sanitized = toSanitizedError(channelError);
          this.events.emit("error", sanitized);
          this.close(sanitized.code);
        });
        resolve();
      });
    });
  }

  private registerClientEvents(): void {
    this.client.once("close", () => this.close(this.closeReason === "closed" ? "client_close" : this.closeReason));
    this.client.once("end", () => this.close(this.closeReason === "closed" ? "client_end" : this.closeReason));
    this.client.on("error", (error) => {
      if (this.state === "closed" || this.state === "connecting") {
        return;
      }
      const sanitized = toSanitizedError(error);
      this.events.emit("error", sanitized);
      this.close(sanitized.code);
    });
    this.client.once("timeout", () => {
      if (this.state === "closed") {
        return;
      }
      this.events.emit("error", { code: ProtocolErrorCode.SshTimeout, message: "SSH connection timed out." });
      this.close(ProtocolErrorCode.SshTimeout);
    });
  }

  private armTimers(): void {
    this.touch();
    this.durationTimer = setTimeout(() => {
      this.events.emit("error", { code: ProtocolErrorCode.SessionClosed, message: "SSH session is closed." });
      this.close("max_duration");
    }, this.maxDurationMs);
  }

  private clearTimers(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
  }

  private safeFields() {
    return { sessionId: this.sessionId, host: this.host, port: this.port, username: this.username };
  }
}
