import { ProtocolErrorCode } from "@ssh-proxy/protocol";

export interface GatewayLogFields {
  sessionId?: string;
  host?: string;
  port?: number;
  username?: string;
  reason?: string;
  code?: ProtocolErrorCode;
}

export interface GatewayLogger {
  info(message: string, fields?: GatewayLogFields): void;
  warn(message: string, fields?: GatewayLogFields): void;
  error(message: string, fields?: GatewayLogFields): void;
}

export const redactedValue = "[redacted]";

export function createConsoleLogger(): GatewayLogger {
  return {
    info(message, fields) {
      console.info(formatLog("info", message, fields));
    },
    warn(message, fields) {
      console.warn(formatLog("warn", message, fields));
    },
    error(message, fields) {
      console.error(formatLog("error", message, fields));
    }
  };
}

export function sanitizeLogText(value: string): string {
  return value
    .replace(/password\s*[:=]\s*\S+/gi, `password=${redactedValue}`)
    .replace(/passphrase\s*[:=]\s*\S+/gi, `passphrase=${redactedValue}`)
    .replace(/\b(testpass|wrongpass)\b/g, redactedValue);
}

function formatLog(level: "info" | "warn" | "error", message: string, fields?: GatewayLogFields): string {
  const safeFields = fields ? sanitizeFields(fields) : undefined;
  return JSON.stringify({ level, message: sanitizeLogText(message), ...safeFields });
}

function sanitizeFields(fields: GatewayLogFields): GatewayLogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, typeof value === "string" ? sanitizeLogText(value) : value])
  );
}
