import { describe, expect, it } from "vitest";
import {
  DATA_FRAME_MAX_DECODED_BYTES,
  HEARTBEAT_INTERVAL_MS,
  IDLE_TIMEOUT_MS,
  MAX_POST_BODY_BYTES,
  MAX_SESSIONS,
  MAX_SESSION_DURATION_MS,
  ProtocolErrorCode,
  RESIZE_COLS_MAX,
  RESIZE_COLS_MIN,
  RESIZE_ROWS_MAX,
  RESIZE_ROWS_MIN,
  SSH_CONNECT_TIMEOUT_MS,
  SSH_PORT_MAX,
  SSH_PORT_MIN,
  decodeBase64,
  encodeBase64,
  validateTerminalFrame
} from "./index";

const baseFrame = {
  sessionId: "session-1",
  seq: 1
};

describe("protocol constants", () => {
  it("exports the terminal frame size, timeout, and count limits", () => {
    expect(DATA_FRAME_MAX_DECODED_BYTES).toBe(4096);
    expect(MAX_POST_BODY_BYTES).toBe(8192);
    expect(RESIZE_COLS_MIN).toBe(20);
    expect(RESIZE_COLS_MAX).toBe(300);
    expect(RESIZE_ROWS_MIN).toBe(5);
    expect(RESIZE_ROWS_MAX).toBe(120);
    expect(SSH_PORT_MIN).toBe(1);
    expect(SSH_PORT_MAX).toBe(65535);
    expect(HEARTBEAT_INTERVAL_MS).toBe(25_000);
    expect(SSH_CONNECT_TIMEOUT_MS).toBe(15_000);
    expect(IDLE_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(MAX_SESSION_DURATION_MS).toBe(8 * 60 * 60 * 1000);
    expect(MAX_SESSIONS).toBe(5);
  });

  it("exports only sanitized protocol error codes", () => {
    expect(Object.values(ProtocolErrorCode).sort()).toEqual(
      [
        "FRAME_TOO_LARGE",
        "INTERNAL_ERROR",
        "SESSION_CLOSED",
        "SSH_AUTH_FAILED",
        "SSH_CONNECT_FAILED",
        "SSH_TIMEOUT",
        "VALIDATION_ERROR"
      ].sort()
    );
  });
});

describe("base64 helpers", () => {
  it("round-trip Unicode and multiline pasted input", () => {
    const pastedInput = "first line\nsecond line with λ and 你好\nthird line";

    expect(decodeBase64(encodeBase64(pastedInput))).toBe(pastedInput);
  });
});

describe("terminal frame validation", () => {
  it("accepts a valid connect frame", () => {
    const result = validateTerminalFrame({
      ...baseFrame,
      type: "connect",
      host: "example.com",
      port: 22,
      username: "operator",
      password: "secret",
      cols: 80,
      rows: 24
    });

    expect(result).toEqual({
      ok: true,
      frame: {
        ...baseFrame,
        type: "connect",
        host: "example.com",
        port: 22,
        username: "operator",
        password: "secret",
        cols: 80,
        rows: 24
      }
    });
  });

  it("accepts valid input and output data frames", () => {
    const dataBase64 = encodeBase64("ls -la\n");

    expect(validateTerminalFrame({ ...baseFrame, type: "input", dataBase64 })).toEqual({
      ok: true,
      frame: { ...baseFrame, type: "input", dataBase64 }
    });
    expect(validateTerminalFrame({ ...baseFrame, type: "output", dataBase64 })).toEqual({
      ok: true,
      frame: { ...baseFrame, type: "output", dataBase64 }
    });
  });

  it("accepts a valid resize frame", () => {
    expect(validateTerminalFrame({ ...baseFrame, type: "resize", cols: 120, rows: 40 })).toEqual({
      ok: true,
      frame: { ...baseFrame, type: "resize", cols: 120, rows: 40 }
    });
  });

  it("accepts connect_ack, error, close, ping, and pong terminal frames", () => {
    expect(validateTerminalFrame({ ...baseFrame, type: "connect_ack" }).ok).toBe(true);
    expect(
      validateTerminalFrame({
        ...baseFrame,
        type: "error",
        code: ProtocolErrorCode.SshTimeout,
        message: "Connection timed out"
      }).ok
    ).toBe(true);
    expect(validateTerminalFrame({ ...baseFrame, type: "close", reason: "client closed" }).ok).toBe(true);
    expect(validateTerminalFrame({ ...baseFrame, type: "ping" }).ok).toBe(true);
    expect(validateTerminalFrame({ ...baseFrame, type: "pong" }).ok).toBe(true);
  });

  it("rejects malformed host, invalid port, empty username, and empty password", () => {
    const validConnect = {
      ...baseFrame,
      type: "connect",
      host: "example.com",
      port: 22,
      username: "operator",
      password: "secret",
      cols: 80,
      rows: 24
    };

    expect(validateTerminalFrame({ ...validConnect, host: "bad host" })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
    expect(validateTerminalFrame({ ...validConnect, port: 0 })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
    expect(validateTerminalFrame({ ...validConnect, username: "" })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
    expect(validateTerminalFrame({ ...validConnect, password: "" })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
  });

  it("rejects invalid resize bounds", () => {
    expect(validateTerminalFrame({ ...baseFrame, type: "resize", cols: 19, rows: 24 })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
    expect(validateTerminalFrame({ ...baseFrame, type: "resize", cols: 80, rows: 121 })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
  });

  it("rejects unknown frame type and invalid base64", () => {
    expect(validateTerminalFrame({ ...baseFrame, type: "shell" })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
    expect(validateTerminalFrame({ ...baseFrame, type: "input", dataBase64: "not base64" })).toMatchObject({
      ok: false,
      code: ProtocolErrorCode.ValidationError
    });
  });

  it("rejects a decoded data frame of 4097 bytes with FRAME_TOO_LARGE", () => {
    const tooLargeData = "x".repeat(DATA_FRAME_MAX_DECODED_BYTES + 1);

    expect(validateTerminalFrame({ ...baseFrame, type: "input", dataBase64: encodeBase64(tooLargeData) })).toEqual({
      ok: false,
      code: ProtocolErrorCode.FrameTooLarge,
      message: "Decoded data frame exceeds 4096 bytes"
    });
  });
});
