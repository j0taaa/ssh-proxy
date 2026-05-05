import { ProtocolErrorCode } from "@ssh-proxy/protocol";

export interface SanitizedGatewayError {
  code: ProtocolErrorCode;
  message: string;
}

export class GatewayProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "GatewayProtocolError";
    this.code = code;
  }
}

export function toSanitizedError(error: unknown): SanitizedGatewayError {
  if (error instanceof GatewayProtocolError) {
    return { code: error.code, message: messageForCode(error.code) };
  }

  if (error instanceof Error) {
    const normalized = error.message.toLowerCase();
    if (normalized.includes("authentication") || normalized.includes("auth")) {
      return { code: ProtocolErrorCode.SshAuthFailed, message: messageForCode(ProtocolErrorCode.SshAuthFailed) };
    }
    if (normalized.includes("timed out") || normalized.includes("timeout")) {
      return { code: ProtocolErrorCode.SshTimeout, message: messageForCode(ProtocolErrorCode.SshTimeout) };
    }
    if (normalized.includes("closed")) {
      return { code: ProtocolErrorCode.SessionClosed, message: messageForCode(ProtocolErrorCode.SessionClosed) };
    }
    return { code: ProtocolErrorCode.SshConnectFailed, message: messageForCode(ProtocolErrorCode.SshConnectFailed) };
  }

  return { code: ProtocolErrorCode.InternalError, message: messageForCode(ProtocolErrorCode.InternalError) };
}

export function messageForCode(code: ProtocolErrorCode): string {
  switch (code) {
    case ProtocolErrorCode.ValidationError:
      return "Invalid terminal frame.";
    case ProtocolErrorCode.SshAuthFailed:
      return "SSH authentication failed.";
    case ProtocolErrorCode.SshTimeout:
      return "SSH connection timed out.";
    case ProtocolErrorCode.SshConnectFailed:
      return "SSH connection failed.";
    case ProtocolErrorCode.SessionClosed:
      return "SSH session is closed.";
    case ProtocolErrorCode.FrameTooLarge:
      return "Terminal frame is too large.";
    case ProtocolErrorCode.InternalError:
      return "Internal gateway error.";
  }
}
