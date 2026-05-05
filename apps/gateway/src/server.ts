import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { GatewayLogger } from "./logger.js";
import { SessionManager, type SessionManagerOptions } from "./session-manager.js";

export interface GatewayServerOptions {
  host?: string;
  port?: number;
  logger: GatewayLogger;
  sessionOptions?: SessionManagerOptions;
}

export function createGatewayServer(options: GatewayServerOptions) {
  const sessionManager = new SessionManager(options.logger, options.sessionOptions);
  const server = createServer((request, response) => handleRequest(request, response));
  server.once("close", () => sessionManager.closeAll("server_close"));
  return { server, sessionManager };
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "GET" && request.url === "/healthz") {
    writeJson(response, 200, { ok: true });
    return;
  }

  writeJson(response, 404, { error: "NOT_FOUND", message: "Gateway route not found." });
}

function writeJson(response: ServerResponse, statusCode: number, payload: object): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
