import { createConsoleLogger } from "./logger.js";
import { createGatewayServer } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "127.0.0.1";
const logger = createConsoleLogger();
const { server } = createGatewayServer({ host, port, logger });

logger.warn("SSH host keys are accepted without verification in this development gateway.");

server.listen(port, host, () => {
  logger.info(`Gateway listening on http://${host}:${port}`);
});
