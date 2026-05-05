import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DATA_FRAME_MAX_DECODED_BYTES, ProtocolErrorCode, decodeBase64ToBytes, type TerminalFrame } from "@ssh-proxy/protocol";
import { connectFrame, inputFrame, isTerminalFrame, outputText, resizeFrame, startGateway } from "./test-utils/gateway-test-utils.js";
import { startMockSshServer } from "./test-utils/mock-ssh-server.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    await cleanupTasks.shift()?.();
  }
});

describe("terminal WebSocket transport", () => {
  it("sends connect_ack after shell readiness and forwards command echo roundtrip", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.wsUrl);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-roundtrip", sshServer.port)));

    const ack = await waitForFrame(webSocket, "connect_ack");
    expect(ack.sessionId).toBe("wss-roundtrip");
    expect(sshServer.shellReadyCount).toBe(1);

    webSocket.send(JSON.stringify(inputFrame("wss-roundtrip", "printf wss-ok\n")));

    const output = await waitForOutputText(webSocket, "printf wss-ok");
    expect(output).toContain("printf wss-ok");
    await sshServer.waitForInput("printf wss-ok\n");
  });

  it("delivers resize frames to the active SSH PTY", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.wsUrl);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-resize", sshServer.port)));
    await waitForFrame(webSocket, "connect_ack");

    webSocket.send(JSON.stringify(resizeFrame("wss-resize", 120, 36)));

    await expect(sshServer.waitForResize(120, 36)).resolves.toBeUndefined();
  });

  it("splits a single large SSH output chunk into protocol-sized output frames", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.wsUrl);
    const collector = new WebSocketFrameCollector(webSocket);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-large-output", sshServer.port)));
    await collector.waitForFrame("connect_ack");

    const outputPromise = collector.waitForOutputFrames("café-雪\nmock$ ");
    sshServer.writeOutput(`small-output\n${"z".repeat(4097)}café-雪\nmock$ `);

    const outputs = await outputPromise;
    expect(outputs.length).toBeGreaterThanOrEqual(2);
    expect(outputs.map(decodedOutputByteLength).every((byteLength) => byteLength <= DATA_FRAME_MAX_DECODED_BYTES)).toBe(true);
    expect(outputs.map(outputText).join("")).toContain(`${"z".repeat(4097)}café-雪`);
  });

  it("rejects invalid host, port, JSON, and oversized decoded frames with sanitized validation errors", async () => {
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.wsUrl);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close);

    webSocket.send(JSON.stringify(connectFrame("bad-host", 22, { host: "bad host" })));
    await expect(waitForFrame(webSocket, "error")).resolves.toMatchObject({ code: ProtocolErrorCode.ValidationError, message: "Invalid terminal frame." });

    webSocket.send(JSON.stringify(connectFrame("bad-port", 0)));
    await expect(waitForFrame(webSocket, "error")).resolves.toMatchObject({ code: ProtocolErrorCode.ValidationError, message: "Invalid terminal frame." });

    webSocket.send(JSON.stringify({ type: "input", sessionId: "bad-frame", seq: 1, dataBase64: "not-base64***" }));
    await expect(waitForFrame(webSocket, "error")).resolves.toMatchObject({ code: ProtocolErrorCode.ValidationError, message: "Invalid terminal frame." });

    webSocket.send(JSON.stringify({ type: "input", sessionId: "bad-frame", seq: 2, dataBase64: Buffer.alloc(DATA_FRAME_MAX_DECODED_BYTES + 1, "x").toString("base64") }));
    await expect(waitForFrame(webSocket, "error")).resolves.toMatchObject({ code: ProtocolErrorCode.FrameTooLarge, message: "Terminal frame is too large." });
    expect(gateway.size()).toBe(0);
  });

  it("cleans up SSH session and channel after tab-style socket disconnect", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    const webSocket = await openWebSocket(gateway.wsUrl);
    cleanupTasks.push(gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-disconnect", sshServer.port)));
    await waitForFrame(webSocket, "connect_ack");
    expect(gateway.size()).toBe(1);

    await closeWebSocket(webSocket);

    await expect(waitForGatewaySize(gateway, 0)).resolves.toBeUndefined();
    await expect(sshServer.waitForChannelClose()).resolves.toBeUndefined();
  });

  it("keeps an active socket open across heartbeat ping/pong checks", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway({ webSocketOptions: { heartbeatIntervalMs: 100 } });
    const webSocket = await openWebSocket(gateway.wsUrl);
    cleanupTasks.push(() => closeWebSocket(webSocket), gateway.close, sshServer.close);

    webSocket.send(JSON.stringify(connectFrame("wss-heartbeat", sshServer.port)));
    await waitForFrame(webSocket, "connect_ack");
    await waitForFrame(webSocket, "ping", 1_000);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(webSocket.readyState).toBe(WebSocket.OPEN);
  });
});

async function openWebSocket(url: string): Promise<WebSocket> {
  const webSocket = new WebSocket(url);
  await once(webSocket, "open");
  return webSocket;
}

function closeWebSocket(webSocket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (webSocket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    webSocket.once("close", () => resolve());
    webSocket.close();
    setTimeout(() => {
      if (webSocket.readyState !== WebSocket.CLOSED) {
        webSocket.terminate();
      }
      resolve();
    }, 250);
  });
}

class WebSocketFrameCollector {
  private readonly pendingFrames: TerminalFrame[] = [];

  constructor(webSocket: WebSocket) {
    webSocket.on("message", (data) => {
      const frame = JSON.parse(data.toString("utf8")) as unknown;
      if (isTerminalFrame(frame)) {
        this.pendingFrames.push(frame);
      }
    });
  }

  async waitForFrame<TType extends TerminalFrame["type"]>(type: TType, timeoutMs = 2_000): Promise<Extract<TerminalFrame, { type: TType }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frameIndex = this.pendingFrames.findIndex((frame) => frame.type === type);
      if (frameIndex >= 0) {
        const [frame] = this.pendingFrames.splice(frameIndex, 1);
        return frame as Extract<TerminalFrame, { type: TType }>;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected ${type} frame`);
  }

  async waitForOutputFrames(expected: string): Promise<Array<Extract<TerminalFrame, { type: "output" }>>> {
    let received = "";
    const outputs: Array<Extract<TerminalFrame, { type: "output" }>> = [];
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const output = await this.waitForFrame("output", Math.max(1, deadline - Date.now()));
      expect(decodedOutputByteLength(output)).toBeLessThanOrEqual(DATA_FRAME_MAX_DECODED_BYTES);
      outputs.push(output);
      received += outputText(output);
      if (received.includes(expected)) {
        return outputs;
      }
    }
    throw new Error(`Expected output ${expected}`);
  }
}

async function waitForFrame<TType extends TerminalFrame["type"]>(webSocket: WebSocket, type: TType, timeoutMs = 2_000): Promise<Extract<TerminalFrame, { type: TType }>> {
  return new Promise((resolve, reject) => {
    const observed: TerminalFrame[] = [];
    const timeout = setTimeout(() => {
      webSocket.off("message", onMessage);
      reject(new Error(`Expected ${type} frame after ${JSON.stringify(observed)}`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const frame = JSON.parse(data.toString("utf8")) as unknown;
      if (isTerminalFrame(frame)) {
        observed.push(frame);
      }
      if (isTerminalFrame(frame) && frame.type === type) {
        clearTimeout(timeout);
        webSocket.off("message", onMessage);
        resolve(frame as Extract<TerminalFrame, { type: TType }>);
      }
    };
    webSocket.on("message", onMessage);
  });
}

async function waitForOutputText(webSocket: WebSocket, expected: string): Promise<string> {
  return (await waitForOutputFrames(webSocket, expected)).map(outputText).join("");
}

async function waitForOutputFrames(webSocket: WebSocket, expected: string): Promise<Array<Extract<TerminalFrame, { type: "output" }>>> {
  let received = "";
  const outputs: Array<Extract<TerminalFrame, { type: "output" }>> = [];
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const output = await waitForFrame(webSocket, "output", Math.max(1, deadline - Date.now()));
    const chunk = outputText(output);
    expect(decodedOutputByteLength(output)).toBeLessThanOrEqual(DATA_FRAME_MAX_DECODED_BYTES);
    outputs.push(output);
    received += chunk;
    if (received.includes(expected)) {
      return outputs;
    }
  }
  throw new Error(`Expected output ${expected}`);
}

function decodedOutputByteLength(output: Extract<TerminalFrame, { type: "output" }>): number {
  return decodeBase64ToBytes(output.dataBase64).byteLength;
}

async function waitForGatewaySize(gateway: { size(): number }, expected: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (gateway.size() === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected gateway size ${expected}`);
}
