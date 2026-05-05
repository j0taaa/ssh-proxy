import { expect, test } from "@playwright/test";

test("web connection form renders with unsafe warnings", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Connect to SSH Server" }),
  ).toBeVisible();
  await expect(page.getByTestId("warning-box")).toBeVisible();
  await expect(
    page.getByText("No built-in application authentication"),
  ).toBeVisible();
  await expect(page.getByTestId("connect-button")).toBeVisible();
  await expect(page.getByTestId("disconnect-button")).toBeDisabled();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Disconnected",
  );
});
