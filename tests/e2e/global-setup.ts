import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { startGateway } from "../../apps/gateway/src/test-utils/gateway-test-utils.js";
import { startMockSshServer, type MockSshServer } from "../../apps/gateway/src/test-utils/mock-ssh-server.js";

const STATE_DIR = join(process.cwd(), ".test-state");
const STATE_FILE = join(STATE_DIR, "e2e-env.json");

export interface E2eState {
  sshPort: number;
  gatewayUrl: string;
  webUrl: string;
  testStateUrl: string;
}

let sshServer: MockSshServer | null = null;
let gateway: { close(): Promise<void>; url: string } | null = null;
let webProcess: ChildProcess | null = null;
let testStateServer: ReturnType<typeof createServer> | null = null;

async function globalSetup() {
  mkdirSync(STATE_DIR, { recursive: true });

  sshServer = await startMockSshServer();
  gateway = await startGateway();

  const webUrl = "http://127.0.0.1:3000";

  testStateServer = createServer((req, res) => {
    if (!sshServer) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "ssh server not available" }));
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/resizes") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(sshServer.resizes));
    } else if (url.pathname === "/inputs") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify(sshServer.inputs));
    } else if (url.pathname === "/shell-ready-count") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ count: sshServer.shellReadyCount }));
    } else if (url.pathname === "/channel-close-count") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ count: sshServer.channelCloseCount }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  testStateServer.listen(0, "127.0.0.1");
  await once(testStateServer, "listening");
  const testStateAddr = testStateServer.address() as AddressInfo;
  const testStateUrl = `http://127.0.0.1:${testStateAddr.port}`;

  const state: E2eState = {
    sshPort: sshServer.port,
    gatewayUrl: gateway.url,
    webUrl,
    testStateUrl,
  };

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log(
    `[e2e] mock SSH port=${sshServer.port}, gateway=${gateway.url}, web=${webUrl}, test-state=${testStateUrl}`,
  );

  webProcess = spawn("npm", ["run", "dev:web"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NEXT_PUBLIC_GATEWAY_URL: gateway.url,
    },
  });

  await waitForWebServer(webUrl);

  return async () => {
    console.log("[e2e] tearing down servers");
    if (webProcess) {
      webProcess.kill("SIGTERM");
      webProcess = null;
    }
    if (testStateServer) {
      testStateServer.close();
      testStateServer = null;
    }
    if (gateway) {
      await gateway.close();
      gateway = null;
    }
    if (sshServer) {
      await sshServer.close();
      sshServer = null;
    }
  };
}

async function waitForWebServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 200) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Web server at ${url} did not become ready within ${timeoutMs}ms`);
}

export function loadE2eState(): E2eState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(`E2E state file not found at ${STATE_FILE}. Run global setup first.`);
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2eState;
}

export default globalSetup;
