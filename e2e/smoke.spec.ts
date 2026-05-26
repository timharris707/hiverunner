import { expect, test } from "@playwright/test";

test("local-first HiveRunner smoke", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /HiveRunner|Sign in|Dashboard|Tasks/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
});
