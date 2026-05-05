import { expect, test, type Page } from "@playwright/test";
import { loadE2eState, type E2eState } from "./global-setup.js";

let state: E2eState;

test.beforeAll(() => {
  state = loadE2eState();
});

async function fillConnectionForm(
  page: Page,
  overrides: { host?: string; port?: string; username?: string; password?: string } = {},
) {
  await page.goto("/");
  await page.getByTestId("host-input").fill(overrides.host ?? "127.0.0.1");
  await page.getByTestId("port-input").fill(overrides.port ?? String(state.sshPort));
  await page.getByTestId("username-input").fill(overrides.username ?? "testuser");
  await page.getByTestId("password-input").fill(overrides.password ?? "testpass");
}

async function connectAndWaitForTerminal(page: Page) {
  await page.getByTestId("connect-button").click();
  await expect(page.getByTestId("terminal-connected")).toBeVisible({ timeout: 10_000 });
}

async function focusTerminal(page: Page) {
  await page.evaluate(() => {
    const textarea = document.querySelector(".xterm textarea") as HTMLTextAreaElement | null;
    if (textarea) textarea.focus();
  });
}

async function typeInTerminal(page: Page, text: string) {
  const terminal = page.getByTestId("terminal-connected");
  await expect(terminal).toBeVisible();
  await focusTerminal(page);
  await page.keyboard.insertText(text);
}

async function getTerminalText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const readBuffer = (window as unknown as Record<string, unknown>).__terminalReadBuffer;
    if (typeof readBuffer === "function") {
      return (readBuffer as () => string)();
    }
    return "";
  });
}

async function waitForTerminalText(page: Page, expected: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    lastText = await getTerminalText(page);
    if (lastText.includes(expected)) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Terminal text did not contain "${expected}" within ${timeoutMs}ms. Last text: ${lastText.slice(0, 500)}`);
}

async function takeTerminalScreenshot(page: Page, path: string) {
  await page.screenshot({ path, fullPage: true });
}

async function fetchMockState<T>(path: string): Promise<T> {
  const response = await fetch(`${state.testStateUrl}${path}`);
  if (!response.ok) throw new Error(`Test state server returned ${response.status}`);
  return response.json() as Promise<T>;
}

test.describe("E2E SSH Terminal", () => {
  test("WSS happy path: connect and see command output", async ({ page }) => {
    await fillConnectionForm(page);
    await connectAndWaitForTerminal(page);

    await expect(page.getByTestId("connection-status")).toContainText("Connected");
    await expect(page.getByTestId("transport-type")).toContainText("WSS");

    await typeInTerminal(page, "echo e2e-wss\n");
    await waitForTerminalText(page, "e2e-wss");

    await takeTerminalScreenshot(page, ".sisyphus/evidence/task-10-e2e-wss.png");
  });

  test("forced HTTP fallback: connect and see command output", async ({ page }) => {
    await fillConnectionForm(page);
    await page.getByTestId("force-http-checkbox").check();
    await connectAndWaitForTerminal(page);

    await expect(page.getByTestId("connection-status")).toContainText("Connected");
    await expect(page.getByTestId("transport-type")).toContainText("HTTP fallback");

    await typeInTerminal(page, "echo e2e-http\n");
    await waitForTerminalText(page, "e2e-http");

    await takeTerminalScreenshot(page, ".sisyphus/evidence/task-10-e2e-http.png");
  });

  test("automatic WSS failure falls back to HTTP within timeout", async ({ page }) => {
    await page.goto("/");

    await page.evaluate(() => {
      class FailingWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 0;
        onopen: (() => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        onclose: ((ev: CloseEvent) => void) | null = null;
        send() { /* noop */ }
        close() {
          this.readyState = 3;
          this.onclose?.(new CloseEvent("close"));
        }
        constructor() {
          setTimeout(() => {
            this.onerror?.(new Event("error"));
            this.readyState = 3;
            this.onclose?.(new CloseEvent("close"));
          }, 50);
        }
      }
      window.WebSocket = FailingWebSocket as unknown as typeof WebSocket;
    });

    await page.getByTestId("host-input").fill("127.0.0.1");
    await page.getByTestId("port-input").fill(String(state.sshPort));
    await page.getByTestId("username-input").fill("testuser");
    await page.getByTestId("password-input").fill("testpass");

    await connectAndWaitForTerminal(page);

    await expect(page.getByTestId("transport-type")).toContainText("HTTP fallback", { timeout: 10_000 });
    await expect(page.getByTestId("connection-status")).toContainText("Connected");

    await typeInTerminal(page, "echo fallback-ok\n");
    await waitForTerminalText(page, "fallback-ok");
  });

  test("localStorage remembers password when checkbox is checked", async ({ page }) => {
    await fillConnectionForm(page);
    await page.getByTestId("remember-password-checkbox").check();
    await connectAndWaitForTerminal(page);

    await expect(page.getByTestId("connection-status")).toContainText("Connected");

    await page.getByTestId("disconnect-button").click();
    await expect(page.getByTestId("connection-status")).toContainText("Disconnected", { timeout: 5_000 });

    await page.reload();
    await page.waitForTimeout(500);

    await expect(page.getByTestId("host-input")).toHaveValue("127.0.0.1");
    await expect(page.getByTestId("port-input")).toHaveValue(String(state.sshPort));
    await expect(page.getByTestId("username-input")).toHaveValue("testuser");
    await expect(page.getByTestId("password-input")).toHaveValue("testpass");
    await expect(page.getByTestId("remember-password-checkbox")).toBeChecked();
  });

  test("invalid form validation blocks connect", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("host-input").fill("");
    await page.getByTestId("port-input").fill("99999");
    await page.getByTestId("username-input").fill("");
    await page.getByTestId("password-input").fill("");
    await page.getByTestId("connect-button").click();

    await expect(page.getByTestId("host-error")).toBeVisible();
    await expect(page.getByTestId("port-error")).toBeVisible();
    await expect(page.getByTestId("username-error")).toBeVisible();
    await expect(page.getByTestId("password-error")).toBeVisible();
    await expect(page.getByTestId("connection-status")).toContainText("Disconnected");
  });

  test("bad SSH credentials show sanitized error", async ({ page }) => {
    await fillConnectionForm(page, { password: "wrongpass" });
    await page.getByTestId("connect-button").click();

    await expect(page.getByTestId("error-message")).toBeVisible({ timeout: 10_000 });
    const errorText = await page.getByTestId("error-message").textContent();
    expect(errorText).toBeTruthy();
    expect(errorText!.toLowerCase()).not.toContain("wrongpass");

    await expect(page.getByTestId("connection-status")).toContainText("Disconnected", { timeout: 5_000 });
  });

  test("terminal resize sends resize to SSH server", async ({ page }) => {
    await fillConnectionForm(page);
    await connectAndWaitForTerminal(page);

    await expect(page.getByTestId("connection-status")).toContainText("Connected");

    const initialResizes = await fetchMockState<Array<{ cols: number; rows: number }>>("/resizes");

    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(500);

    const updatedResizes = await fetchMockState<Array<{ cols: number; rows: number }>>("/resizes");
    expect(updatedResizes.length).toBeGreaterThan(initialResizes.length);
  });

  test("Unicode output round-trips through terminal", async ({ page }) => {
    await fillConnectionForm(page);
    await connectAndWaitForTerminal(page);

    await typeInTerminal(page, "second-line\n");
    await waitForTerminalText(page, "café");
    await waitForTerminalText(page, "雪");
  });

  test("multiline paste round-trips through terminal", async ({ page }) => {
    await fillConnectionForm(page);
    await connectAndWaitForTerminal(page);

    await focusTerminal(page);
    await page.keyboard.insertText("paste-a\npaste-b\npaste-c\n");

    await waitForTerminalText(page, "paste-a");
    await waitForTerminalText(page, "paste-b");
    await waitForTerminalText(page, "paste-c");
  });

  test("explicit disconnect closes session and returns to disconnected state", async ({ page }) => {
    await fillConnectionForm(page);
    await connectAndWaitForTerminal(page);

    await expect(page.getByTestId("connection-status")).toContainText("Connected");

    await page.getByTestId("disconnect-button").click();

    await expect(page.getByTestId("connection-status")).toContainText("Disconnected", { timeout: 5_000 });
    await expect(page.getByTestId("disconnect-button")).toBeDisabled();
    await expect(page.getByTestId("terminal-placeholder")).toBeVisible();
    await expect(page.getByTestId("terminal-connected")).not.toBeVisible();
  });
});
