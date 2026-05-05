import { expect, test } from "@playwright/test";

test("web scaffold renders without SSH behavior", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Scaffold ready" })).toBeVisible();
  await expect(page.getByText("SSH connection flows are intentionally not implemented")).toBeVisible();
});
