export const DATA_FRAME_MAX_DECODED_BYTES = 4096;
export const MAX_POST_BODY_BYTES = 8192;
export const RESIZE_COLS_MIN = 20;
export const RESIZE_COLS_MAX = 300;
export const RESIZE_ROWS_MIN = 5;
export const RESIZE_ROWS_MAX = 120;
export const SSH_PORT_MIN = 1;
export const SSH_PORT_MAX = 65535;
export const HEARTBEAT_INTERVAL_MS = 25_000;
export const SSH_CONNECT_TIMEOUT_MS = 15_000;
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
export const MAX_SESSIONS = 5;
export const scaffoldStatus = "Shared terminal protocol contract is ready for frame validation.";

export enum ProtocolErrorCode {
  ValidationError = "VALIDATION_ERROR",
  SshAuthFailed = "SSH_AUTH_FAILED",
  SshConnectFailed = "SSH_CONNECT_FAILED",
  SshTimeout = "SSH_TIMEOUT",
  SessionClosed = "SESSION_CLOSED",
  FrameTooLarge = "FRAME_TOO_LARGE",
  InternalError = "INTERNAL_ERROR"
}

export type TerminalFrameType =
  | "connect"
  | "connect_ack"
  | "input"
  | "resize"
  | "output"
  | "error"
  | "close"
  | "ping"
  | "pong";

export interface BaseFrame {
  type: TerminalFrameType;
  sessionId: string;
  seq: number;
}

export interface ConnectFrame extends BaseFrame {
  type: "connect";
  host: string;
  port: number;
  username: string;
  password: string;
  cols: number;
  rows: number;
}

export interface ConnectAckFrame extends BaseFrame {
  type: "connect_ack";
}

export interface InputFrame extends BaseFrame {
  type: "input";
  dataBase64: string;
}

export interface ResizeFrame extends BaseFrame {
  type: "resize";
  cols: number;
  rows: number;
}

export interface OutputFrame extends BaseFrame {
  type: "output";
  dataBase64: string;
}

export interface ErrorFrame extends BaseFrame {
  type: "error";
  code: ProtocolErrorCode;
  message: string;
}

export interface CloseFrame extends BaseFrame {
  type: "close";
  reason: string;
}

export interface PingFrame extends BaseFrame {
  type: "ping";
}

export interface PongFrame extends BaseFrame {
  type: "pong";
}

export type TerminalFrame =
  | ConnectFrame
  | ConnectAckFrame
  | InputFrame
  | ResizeFrame
  | OutputFrame
  | ErrorFrame
  | CloseFrame
  | PingFrame
  | PongFrame;

export type ValidationResult<TFrame extends TerminalFrame = TerminalFrame> =
  | { ok: true; frame: TFrame }
  | { ok: false; code: ProtocolErrorCode; message: string };

const terminalFrameTypes = new Set<TerminalFrameType>([
  "connect",
  "connect_ack",
  "input",
  "resize",
  "output",
  "error",
  "close",
  "ping",
  "pong"
]);

const protocolErrorCodes = new Set<string>(Object.values(ProtocolErrorCode));
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeBase64(value: string): string {
  return bytesToBase64(textEncoder.encode(value));
}

export function decodeBase64(value: string): string {
  return textDecoder.decode(decodeBase64ToBytes(value));
}

export function decodeBase64ToBytes(value: string): Uint8Array {
  if (!isValidBase64(value)) {
    throw new Error("Invalid base64 input");
  }

  if (value.length === 0) {
    return new Uint8Array();
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }

  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function validateTerminalFrame(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return validationError("Frame must be a JSON object");
  }

  const type = value.type;
  if (typeof type !== "string" || !terminalFrameTypes.has(type as TerminalFrameType)) {
    return validationError("Unknown frame type");
  }

  const baseResult = validateBaseFields(value);
  if (!baseResult.ok) {
    return baseResult;
  }

  switch (type) {
    case "connect":
      return validateConnectFrame(value);
    case "connect_ack":
      return { ok: true, frame: value as unknown as ConnectAckFrame };
    case "input":
      return validateDataFrame(value);
    case "resize":
      return validateResizeFrame(value);
    case "output":
      return validateDataFrame(value);
    case "error":
      return validateErrorFrame(value);
    case "close":
      return validateCloseFrame(value);
    case "ping":
      return { ok: true, frame: value as unknown as PingFrame };
    case "pong":
      return { ok: true, frame: value as unknown as PongFrame };
  }

  return validationError("Unknown frame type");
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return globalThis.btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidBase64(value: string): boolean {
  return value.length % 4 === 0 && base64Pattern.test(value);
}

function validateBaseFields(frame: Record<string, unknown>): ValidationResult {
  if (typeof frame.sessionId !== "string" || frame.sessionId.trim().length === 0) {
    return validationError("Invalid sessionId");
  }

  if (!isIntegerInRange(frame.seq, 0, Number.MAX_SAFE_INTEGER)) {
    return validationError("Invalid seq");
  }

  return { ok: true, frame: frame as unknown as TerminalFrame };
}

function validateConnectFrame(frame: Record<string, unknown>): ValidationResult<ConnectFrame> {
  if (typeof frame.host !== "string" || frame.host.trim().length === 0 || /\s/.test(frame.host)) {
    return validationError("Invalid host");
  }

  if (!isIntegerInRange(frame.port, SSH_PORT_MIN, SSH_PORT_MAX)) {
    return validationError("Invalid port");
  }

  if (typeof frame.username !== "string" || frame.username.length === 0) {
    return validationError("Invalid username");
  }

  if (typeof frame.password !== "string" || frame.password.length === 0) {
    return validationError("Invalid password");
  }

  const resizeResult = validateResizeBounds(frame.cols, frame.rows);
  if (!resizeResult.ok) {
    return resizeResult;
  }

  return { ok: true, frame: frame as unknown as ConnectFrame };
}

function validateDataFrame<TFrame extends InputFrame | OutputFrame>(frame: Record<string, unknown>): ValidationResult<TFrame> {
  if (typeof frame.dataBase64 !== "string" || !isValidBase64(frame.dataBase64)) {
    return validationError("Invalid base64 data");
  }

  const decodedSize = decodeBase64ToBytes(frame.dataBase64).byteLength;
  if (decodedSize > DATA_FRAME_MAX_DECODED_BYTES) {
    return {
      ok: false,
      code: ProtocolErrorCode.FrameTooLarge,
      message: "Decoded data frame exceeds 4096 bytes"
    };
  }

  return { ok: true, frame: frame as unknown as TFrame };
}

function validateResizeFrame(frame: Record<string, unknown>): ValidationResult<ResizeFrame> {
  const resizeResult = validateResizeBounds(frame.cols, frame.rows);
  if (!resizeResult.ok) {
    return resizeResult;
  }

  return { ok: true, frame: frame as unknown as ResizeFrame };
}

function validateResizeBounds(cols: unknown, rows: unknown): ValidationResult {
  if (!isIntegerInRange(cols, RESIZE_COLS_MIN, RESIZE_COLS_MAX)) {
    return validationError("Invalid resize cols");
  }

  if (!isIntegerInRange(rows, RESIZE_ROWS_MIN, RESIZE_ROWS_MAX)) {
    return validationError("Invalid resize rows");
  }

  return { ok: true, frame: { type: "resize", sessionId: "validated", seq: 0, cols, rows } };
}

function validateErrorFrame(frame: Record<string, unknown>): ValidationResult<ErrorFrame> {
  if (typeof frame.code !== "string" || !protocolErrorCodes.has(frame.code)) {
    return validationError("Invalid error code");
  }

  if (typeof frame.message !== "string" || frame.message.length === 0) {
    return validationError("Invalid error message");
  }

  return { ok: true, frame: frame as unknown as ErrorFrame };
}

function validateCloseFrame(frame: Record<string, unknown>): ValidationResult<CloseFrame> {
  if (typeof frame.reason !== "string") {
    return validationError("Invalid close reason");
  }

  return { ok: true, frame: frame as unknown as CloseFrame };
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function validationError(message: string): ValidationResult<never> {
  return { ok: false, code: ProtocolErrorCode.ValidationError, message };
}
