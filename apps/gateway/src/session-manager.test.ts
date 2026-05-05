import { createServer } from "node:net";
import { ProtocolErrorCode } from "@ssh-proxy/protocol";
import { describe, expect, it } from "vitest";
import { toSanitizedError } from "./errors.js";
import { SessionManager } from "./session-manager.js";
import { connectFrame, inputFrame, MemoryLogger, onceSessionClose, resizeFrame, waitForSessionOutput } from "./test-utils/gateway-test-utils.js";
import { startMockSshServer } from "./test-utils/mock-ssh-server.js";

describe("SessionManager SSH core", () => {
  it("opens a password SSH PTY shell, echoes input, records resize, and closes explicitly", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);
    const sessionId = "happy-session";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port));
      const outputPromise = waitForSessionOutput(session, "echo ok");

      manager.writeInput(inputFrame(sessionId, "echo ok\n"));
      manager.resizeSession(resizeFrame(sessionId, 100, 40));

      await expect(outputPromise).resolves.toContain("echo ok");
      await sshServer.waitForInput("echo ok\n");
      await sshServer.waitForResize(100, 40);
      expect(sshServer.inputs).toContain("echo ok\n");
      expect(sshServer.resizes).toContainEqual({ cols: 100, rows: 40 });

      manager.closeSession(sessionId, "test_close");
      expect(manager.size).toBe(0);
      await sshServer.waitForChannelClose();
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("round-trips Unicode and multiline paste through the SSH shell", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);
    const sessionId = "unicode-multiline-session";
    const pastedInput = "printf café-雪\nprintf second-line\n";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port));
      const outputPromise = waitForSessionOutput(session, "second-line");

      manager.writeInput(inputFrame(sessionId, pastedInput));

      const output = await outputPromise;
      expect(output).toContain("café-雪");
      expect(output).toContain("second-line");
      await sshServer.waitForInput(pastedInput);
      expect(sshServer.inputs).toContain(pastedInput);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("rejects bad passwords with sanitized auth failure and redacted logs", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);

    try {
      await expect(manager.createSession(connectFrame("bad-auth-session", sshServer.port, { password: "wrongpass" }))).rejects.toMatchObject({
        code: ProtocolErrorCode.SshAuthFailed
      });

      const logs = logger.text();
      expect(logs).not.toContain("wrongpass");
      expect(logs).not.toContain("testpass");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("maps unreachable hosts and timeout errors to sanitized failures", async () => {
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger, { readyTimeoutMs: 100 });
    const unreachablePort = await getUnusedLocalPort();

    await expect(manager.createSession(connectFrame("unreachable-session", unreachablePort))).rejects.toMatchObject({ code: ProtocolErrorCode.SshConnectFailed });
    expect(toSanitizedError(new Error("operation timed out"))).toEqual({ code: ProtocolErrorCode.SshTimeout, message: "SSH connection timed out." });
    expect(logger.text()).not.toContain("testpass");
    expect(manager.size).toBe(0);
  });

  it("removes sessions when the SSH channel closes", async () => {
    const sshServer = await startMockSshServer({ closeOnInput: "exit\n" });
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);
    const sessionId = "channel-close-session";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port));
      const closed = onceSessionClose(session);
      manager.writeInput(inputFrame(sessionId, "exit\n"));

      await expect(closed).resolves.toBe("channel_close");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("removes idle sessions after the configured timeout", async () => {
    const sshServer = await startMockSshServer();
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger, { idleTimeoutMs: 1_000 });
    const sessionId = "idle-session";

    try {
      const session = await manager.createSession(connectFrame(sessionId, sshServer.port));
      const closed = onceSessionClose(session);

      await expect(closed).resolves.toBe("idle_timeout");
      expect(manager.size).toBe(0);
    } finally {
      manager.closeAll("test_cleanup");
      await sshServer.close();
    }
  });

  it("validates connect and resize frames before touching SSH state", async () => {
    const logger = new MemoryLogger();
    const manager = new SessionManager(logger);

    await expect(manager.createSession({ type: "connect", sessionId: "invalid", seq: 0 })).rejects.toMatchObject({
      code: ProtocolErrorCode.ValidationError
    });
    await expect(manager.createSession(connectFrame("invalid-host", 22, { host: "bad host" }))).rejects.toMatchObject({
      code: ProtocolErrorCode.ValidationError
    });
    await expect(manager.createSession(connectFrame("invalid-port", 0))).rejects.toMatchObject({
      code: ProtocolErrorCode.ValidationError
    });
    expect(() => manager.resizeSession(resizeFrame("missing", 10, 40))).toThrow("Invalid resize cols");
    expect(manager.size).toBe(0);
  });

  it("maps unknown non-Error failures to sanitized internal errors", () => {
    expect(toSanitizedError("boom")).toEqual({
      code: ProtocolErrorCode.InternalError,
      message: "Internal gateway error."
    });
  });
});

async function getUnusedLocalPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP test server address");
  }
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
