import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import ssh2 from "ssh2";

const { Server, utils } = ssh2;

const evidencePath = ".sisyphus/evidence/task-11-docker-smoke.txt";
const projectName = process.env.COMPOSE_PROJECT_NAME || "ssh-proxy-smoke";
const webUrl = "http://127.0.0.1:3000";
const gatewayUrl = "http://127.0.0.1:3001";
const evidence = [];

let mockSshServer = null;

function record(line) {
  const entry = `${new Date().toISOString()} ${line}`;
  evidence.push(entry);
  console.log(entry);
}

async function run(command, args, options = {}) {
  record(`$ ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(text);
  });
  const [code] = await once(child, "close");
  record(`exit ${code}: ${command} ${args.join(" ")}`);
  if (output.trim()) {
    evidence.push(output.trim());
  }
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
  }
  return output;
}

async function runAllowFailure(command, args) {
  try {
    await run(command, args);
    return "ok";
  } catch (error) {
    record(`allowed failure: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}

async function startMockSshServer() {
  const hostKey = utils.generateKeyPairSync("ed25519").private;
  const server = new Server({ hostKeys: [hostKey] });
  const clients = new Set();
  const inputs = [];

  server.on("connection", (client) => {
    clients.add(client);
    client.once("close", () => clients.delete(client));
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
        context.accept();
        return;
      }
      context.reject(["password"]);
    });
    client.on("ready", () => {
      client.on("session", (accept, reject) => {
        const session = accept();
        session.on("pty", (acceptPty) => acceptPty());
        session.on("shell", (acceptShell) => {
          const channel = acceptShell();
          channel.write("docker-smoke-ready\nmock$ ");
          channel.on("data", (chunk) => {
            const input = chunk.toString("utf8");
            inputs.push(input);
            channel.write(Buffer.from(input, "utf8"));
            channel.write("mock$ ");
          });
          channel.on("end", () => channel.close());
        });
        session.on("exec", () => reject());
      });
    });
  });

  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  const address = server.address();
  record(`mock SSH listening on host port ${address.port}`);

  return {
    port: address.port,
    inputs,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of clients) client.end();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function waitForUrl(url, expectedDescription, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not requested";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        record(`${expectedDescription} healthy: ${url}`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${expectedDescription} did not become healthy at ${url}: ${lastError}`);
}

async function waitForTerminalText(page, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    lastText = await page.evaluate(() => {
      const readBuffer = globalThis.__terminalReadBuffer;
      return typeof readBuffer === "function" ? readBuffer() : "";
    });
    if (lastText.includes(expected)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Terminal did not contain ${expected}. Last text: ${String(lastText).slice(0, 300)}`);
}

async function runBrowserSmoke(mockPort, forceHttp) {
  const marker = forceHttp ? "docker-http-smoke" : "docker-wss-smoke";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(webUrl);
    await page.getByTestId("host-input").fill("host.docker.internal");
    await page.getByTestId("port-input").fill(String(mockPort));
    await page.getByTestId("username-input").fill("testuser");
    await page.getByTestId("password-input").fill("testpass");
    if (forceHttp) {
      await page.getByTestId("force-http-checkbox").check();
    }
    await page.getByTestId("connect-button").click();
    await page.getByTestId("terminal-connected").waitFor({ state: "visible", timeout: 15_000 });
    await page.evaluate(() => {
      const textarea = document.querySelector(".xterm textarea");
      if (textarea instanceof HTMLTextAreaElement) textarea.focus();
    });
    await page.keyboard.insertText(`${marker}\n`);
    await waitForTerminalText(page, marker);
    await page.getByTestId("disconnect-button").click();
    await page.getByTestId("terminal-placeholder").waitFor({ state: "visible", timeout: 5_000 });
    record(`browser smoke passed for ${forceHttp ? "HTTP fallback" : "WSS"}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(".sisyphus/evidence", { recursive: true });
  let exitCode = 0;
  let teardownResult = "not-run";

  try {
    mockSshServer = await startMockSshServer();
    await run("npx", ["playwright", "install", "chromium"]);
    await run("docker", ["compose", "-p", projectName, "build"], {
      env: { NEXT_PUBLIC_GATEWAY_URL: gatewayUrl },
    });
    await run("docker", ["compose", "-p", projectName, "up", "-d"], {
      env: { NEXT_PUBLIC_GATEWAY_URL: gatewayUrl },
    });
    await waitForUrl(`${gatewayUrl}/healthz`, "gateway");
    await waitForUrl(`${webUrl}/healthz`, "web");
    await run("docker", ["compose", "-p", projectName, "ps"]);
    await runBrowserSmoke(mockSshServer.port, false);
    await runBrowserSmoke(mockSshServer.port, true);
    record(`mock SSH observed input markers: ${mockSshServer.inputs.join("").includes("docker-wss-smoke") && mockSshServer.inputs.join("").includes("docker-http-smoke")}`);
  } catch (error) {
    exitCode = 1;
    record(`smoke failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  } finally {
    teardownResult = await runAllowFailure("docker", ["compose", "-p", projectName, "down", "--remove-orphans"]);
    if (mockSshServer) {
      await mockSshServer.close();
      record("mock SSH server stopped");
    }
    record(`teardown result: ${teardownResult}`);
    record(exitCode === 0 ? "docker smoke result: PASS" : "docker smoke result: FAIL");
    writeFileSync(evidencePath, `${evidence.join("\n")}\n`);
  }

  process.exit(exitCode);
}

await main();
