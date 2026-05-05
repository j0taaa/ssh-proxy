import { once } from "node:events";
import { type AddressInfo } from "node:net";
import { Server, utils, type AuthContext, type Connection, type ServerChannel, type Session, type WindowChangeInfo } from "ssh2";

export interface MockSshServer {
  port: number;
  inputs: string[];
  resizes: Array<{ cols: number; rows: number }>;
  shellReadyCount: number;
  channelCloseCount: number;
  close(): Promise<void>;
  waitForInput(expected: string): Promise<void>;
  waitForResize(cols: number, rows: number): Promise<void>;
  waitForChannelClose(): Promise<void>;
  writeOutput(value: string): void;
}

export async function startMockSshServer(options: { closeOnInput?: string } = {}): Promise<MockSshServer> {
  const hostKey = utils.generateKeyPairSync("ed25519").private;
  const inputs: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  const clients: Connection[] = [];
  const channels: ServerChannel[] = [];
  const server = new Server({ hostKeys: [hostKey] });
  let shellReadyCount = 0;
  let channelCloseCount = 0;

  server.on("connection", (client) => {
    clients.push(client);
    client.on("authentication", (context: AuthContext) => {
      if (context.method === "password" && context.username === "testuser" && context.password === "testpass") {
        context.accept();
        return;
      }
      context.reject(["password"]);
    });

    client.on("ready", () => {
      client.on("session", (accept, reject) => {
        const session = accept();
        wireSession(session, inputs, resizes, channels, options, () => {
          shellReadyCount += 1;
        }, () => {
          channelCloseCount += 1;
        }, reject);
      });
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    inputs,
    resizes,
    get shellReadyCount() {
      return shellReadyCount;
    },
    get channelCloseCount() {
      return channelCloseCount;
    },
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of clients) {
          client.end();
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    waitForInput: (expected: string) => waitUntil(() => inputs.join("").includes(expected), `Expected input ${expected}`),
    waitForResize: (cols: number, rows: number) => waitUntil(() => resizes.some((resize) => resize.cols === cols && resize.rows === rows), `Expected resize ${cols}x${rows}`),
    waitForChannelClose: () => waitUntil(() => channelCloseCount > 0, "Expected SSH channel close"),
    writeOutput: (value: string) => {
      if (channels.length === 0) {
        throw new Error("Expected open SSH channel");
      }
      for (const channel of channels) {
        channel.write(value);
      }
    }
  };
}

function wireSession(
  session: Session,
  inputs: string[],
  resizes: Array<{ cols: number; rows: number }>,
  channels: ServerChannel[],
  options: { closeOnInput?: string },
  onShellReady: () => void,
  onChannelClose: () => void,
  rejectSession: () => void
): void {
  session.on("pty", (accept, reject, info) => {
    if (info.cols >= 20 && info.rows >= 5) {
      accept();
      return;
    }
    reject();
  });
  session.on("window-change", (_accept, _reject, info) => {
    if (isWindowChangeInfo(info) && info.cols >= 20 && info.rows >= 5) {
      resizes.push({ cols: info.cols, rows: info.rows });
    }
  });
  session.on("shell", (accept) => {
    const channel = accept();
    channels.push(channel);
    onShellReady();
    wireShell(channel, inputs, options, onChannelClose);
  });
  session.on("exec", () => rejectSession());
}

function wireShell(channel: ServerChannel, inputs: string[], options: { closeOnInput?: string }, onChannelClose: () => void): void {
  channel.write("mock-shell-ready\nmock$ ");
  channel.once("close", onChannelClose);
  channel.on("end", () => channel.close());
  channel.on("data", (chunk: Buffer) => {
    const input = chunk.toString("utf8");
    inputs.push(input);
    if (options.closeOnInput && input === options.closeOnInput) {
      channel.close();
      return;
    }
    if (input.includes("burst")) {
      setTimeout(() => {
        channel.write("x".repeat(4000));
        channel.write(`${"y".repeat(1024)}\nmock$ `);
      }, 10);
      return;
    }
    if (input.includes("second-line")) {
      setTimeout(() => {
        channel.write("café-雪\nsecond-line\nmock$ ");
      }, 10);
      return;
    }
    channel.write(Buffer.from(input, "utf8"));
    if (input.includes("single-large-output")) {
      channel.write(`${"z".repeat(4097)}café-雪\n`);
    }
    channel.write("mock$ ");
  });
}

async function waitUntil(predicate: () => boolean, errorMessage: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(errorMessage);
}

function isWindowChangeInfo(value: unknown): value is WindowChangeInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "cols" in value &&
    "rows" in value &&
    typeof value.cols === "number" &&
    typeof value.rows === "number"
  );
}
