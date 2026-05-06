import { afterEach, describe, expect, it } from "vitest";
import { DATA_FRAME_MAX_DECODED_BYTES, MAX_POST_BODY_BYTES, ProtocolErrorCode, decodeBase64ToBytes, type TerminalFrame } from "@ssh-proxy/protocol";
import { connectFrame, inputFrame, isTerminalFrame, outputText, resizeFrame, startGateway } from "./test-utils/gateway-test-utils.js";
import { startMockSshServer } from "./test-utils/mock-ssh-server.js";

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    await cleanupTasks.shift()?.();
  }
});

describe("terminal HTTP SSE/POST fallback transport", () => {
  it("creates a session, streams output over SSE, and sends command echo over POST", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-roundtrip";
    const createResponse = await postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port));
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual({ sessionId });
    expect(sshServer.shellReadyCount).toBe(1);

    const sseClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    cleanupTasks.unshift(() => sseClient.close());

    const inputResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, inputFrame(sessionId, "printf http-ok\n"));
    expect(inputResponse.status).toBe(202);

    const output = await waitForOutputText(sseClient, "printf http-ok");
    expect(output).toContain("printf http-ok");
    await sshServer.waitForInput("printf http-ok\n");
  });

  it("allows dev browser CORS preflight, POST, and SSE from the web origin", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const origin = "http://127.0.0.1:3000";
    const sessionId = "http-cors";
    const preflightResponse = await fetch(`${gateway.url}/sessions`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });
    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflightResponse.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflightResponse.headers.get("access-control-allow-headers")).toContain("content-type");

    const createResponse = await postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port), { origin });
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("access-control-allow-origin")).toBe(origin);

    const sseClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`, { origin });
    cleanupTasks.unshift(() => sseClient.close());
    expect(sseClient.allowOrigin).toBe(origin);

    const inputResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, inputFrame(sessionId, "printf http-ok\n"), { origin });
    expect(inputResponse.status).toBe(202);
    expect(inputResponse.headers.get("access-control-allow-origin")).toBe(origin);
    await expect(waitForOutputText(sseClient, "printf http-ok")).resolves.toContain("printf http-ok");
  });

  it("delivers POST resize frames to the active SSH PTY", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-resize";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });

    const resizeResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, resizeFrame(sessionId, 132, 43));
    expect(resizeResponse.status).toBe(202);
    await expect(sshServer.waitForResize(132, 43)).resolves.toBeUndefined();
  });

  it("rejects invalid create frames, oversized POST bodies, and oversized decoded data without writing to SSH", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const invalidHost = await postJson(`${gateway.url}/sessions`, connectFrame("http-invalid-host", sshServer.port, { host: "bad host" }));
    expect(invalidHost.status).toBe(400);
    expect(await invalidHost.json()).toEqual({ error: ProtocolErrorCode.ValidationError, message: "Invalid terminal frame." });

    const invalidPort = await postJson(`${gateway.url}/sessions`, connectFrame("http-invalid-port", 0));
    expect(invalidPort.status).toBe(400);

    const sessionId = "http-oversize";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });

    const oversizedDecoded = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      type: "input",
      sessionId,
      seq: 2,
      dataBase64: Buffer.alloc(DATA_FRAME_MAX_DECODED_BYTES + 1, "x").toString("base64")
    });
    expect(oversizedDecoded.status).toBe(413);
    expect(await oversizedDecoded.json()).toEqual({ error: ProtocolErrorCode.FrameTooLarge, message: "Terminal frame is too large." });

    const oversizedBody = await fetch(`${gateway.url}/sse/terminal/${sessionId}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "input", sessionId, seq: 3, dataBase64: "" }).padEnd(MAX_POST_BODY_BYTES + 1, " ")
    });
    expect(oversizedBody.status).toBe(413);
    expect(sshServer.inputs).toEqual([]);
  });

  it("returns sanitized auth errors and keeps passwords out of gateway logs", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const response = await postJson(`${gateway.url}/sessions`, connectFrame("http-bad-auth", sshServer.port, { password: "wrongpass" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: ProtocolErrorCode.SshAuthFailed, message: "SSH authentication failed." });
    expect(gateway.logger.text()).not.toContain("wrongpass");
    expect(gateway.logger.text()).not.toContain("testpass");
    expect(gateway.size()).toBe(0);
  });

  it("allows SSE reconnect to the same active in-memory session", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-reconnect";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });

    const firstClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    await firstClient.close();
    expect(gateway.size()).toBe(1);

    const secondClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    cleanupTasks.unshift(() => secondClient.close());
    const inputResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, inputFrame(sessionId, "printf reconnect-ok\n"));
    expect(inputResponse.status).toBe(202);

    const output = await waitForOutputText(secondClient, "printf reconnect-ok");
    expect(output).toContain("printf reconnect-ok");
    expect(gateway.size()).toBe(1);
  });

  it("streams large output bursts, Unicode, and multiline pasted input over SSE", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);
    const sessionId = "http-rich-output";

    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });
    const sseClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    cleanupTasks.unshift(() => sseClient.close());

    const pastedInput = "printf café-雪\nprintf second-line\n";
    await expect(postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, inputFrame(sessionId, pastedInput))).resolves.toMatchObject({ status: 202 });
    const unicodeOutput = await waitForOutputText(sseClient, "second-line");
    expect(unicodeOutput).toContain("café-雪");
    expect(unicodeOutput).toContain("second-line");

    await expect(postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, inputFrame(sessionId, "burst\n", 3))).resolves.toMatchObject({ status: 202 });
    const burstOutput = await waitForOutputText(sseClient, "yyyyyyyyyy");
    expect(burstOutput).toContain("x".repeat(4000));
    expect(burstOutput).toContain("y".repeat(1024));
    await sshServer.waitForInput(pastedInput);
    await sshServer.waitForInput("burst\n");
  });

  it("splits a single large SSH output chunk into protocol-sized SSE output frames", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);
    const sessionId = "http-large-output";

    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });
    const sseClient = await SseClient.open(`${gateway.url}/sse/terminal/${sessionId}/events`);
    cleanupTasks.unshift(() => sseClient.close());

    await expect(postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, inputFrame(sessionId, "single-large-output\n"))).resolves.toMatchObject({ status: 202 });

    const outputs = await waitForOutputFrames(sseClient, `${"z".repeat(4097)}café-雪`);
    expect(outputs.length).toBeGreaterThanOrEqual(2);
    expect(outputs.map(decodedOutputByteLength).every((byteLength) => byteLength <= DATA_FRAME_MAX_DECODED_BYTES)).toBe(true);
    expect(outputs.map(outputText).join("")).toContain(`${"z".repeat(4097)}café-雪`);
    await sshServer.waitForInput("single-large-output\n");
  });

  it("explicit close POST closes SSH and removes the managed session", async () => {
    const sshServer = await startMockSshServer();
    const gateway = await startGateway();
    cleanupTasks.push(gateway.close, sshServer.close);

    const sessionId = "http-close";
    await expect(postJson(`${gateway.url}/sessions`, connectFrame(sessionId, sshServer.port))).resolves.toMatchObject({ status: 201 });
    expect(gateway.size()).toBe(1);

    const closeResponse = await postJson(`${gateway.url}/sse/terminal/${sessionId}/input`, { type: "close", sessionId, seq: 2, reason: "test_close" });
    expect(closeResponse.status).toBe(202);
    expect(gateway.size()).toBe(0);
    await expect(sshServer.waitForChannelClose()).resolves.toBeUndefined();
  });
});

class SseClient {
  private readonly response: Response;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly pendingBlocks: string[] = [];
  private buffer = "";

  private constructor(response: Response, reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.response = response;
    this.reader = reader;
  }

  get allowOrigin(): string | null {
    return this.response.headers.get("access-control-allow-origin");
  }

  static async open(url: string, headers?: HeadersInit): Promise<SseClient> {
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    if (!response.body) {
      throw new Error("Expected SSE response body");
    }
    return new SseClient(response, response.body.getReader());
  }

  async waitForFrame<TType extends TerminalFrame["type"]>(type: TType, timeoutMs = 2_000): Promise<Extract<TerminalFrame, { type: TType }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = this.shiftFrame(type);
      if (frame) {
        return frame;
      }
      const readTimeoutMs = Math.max(1, deadline - Date.now());
      const readResult = await Promise.race([
        this.reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => setTimeout(() => reject(new Error(`Expected ${type} SSE frame`)), readTimeoutMs))
      ]);
      if (readResult.done) {
        break;
      }
      this.buffer += this.decoder.decode(readResult.value, { stream: true });
      this.extractBlocks();
    }
    throw new Error(`Expected ${type} SSE frame`);
  }

  async close(): Promise<void> {
    await this.reader.cancel();
    await this.response.body?.cancel().catch(() => undefined);
  }

  private extractBlocks(): void {
    let delimiterIndex = this.buffer.indexOf("\n\n");
    while (delimiterIndex >= 0) {
      this.pendingBlocks.push(this.buffer.slice(0, delimiterIndex));
      this.buffer = this.buffer.slice(delimiterIndex + 2);
      delimiterIndex = this.buffer.indexOf("\n\n");
    }
  }

  private shiftFrame<TType extends TerminalFrame["type"]>(type: TType): Extract<TerminalFrame, { type: TType }> | undefined {
    while (this.pendingBlocks.length > 0) {
      const block = this.pendingBlocks.shift();
      if (!block || block.startsWith(":")) {
        continue;
      }
      const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) {
        continue;
      }
      const frame = JSON.parse(dataLine.slice("data: ".length)) as unknown;
      if (isTerminalFrame(frame) && frame.type === type) {
        return frame as Extract<TerminalFrame, { type: TType }>;
      }
    }
    return undefined;
  }
}

async function postJson(url: string, body: object, headers: HeadersInit = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

async function waitForOutputText(sseClient: SseClient, expected: string): Promise<string> {
  return (await waitForOutputFrames(sseClient, expected)).map(outputText).join("");
}

async function waitForOutputFrames(sseClient: SseClient, expected: string): Promise<Array<Extract<TerminalFrame, { type: "output" }>>> {
  let received = "";
  const outputs: Array<Extract<TerminalFrame, { type: "output" }>> = [];
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const output = await sseClient.waitForFrame("output", Math.max(1, deadline - Date.now()));
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
