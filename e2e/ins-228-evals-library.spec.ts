import { expect, test } from "@playwright/test";

test.describe("INS-228 Evals library and Activity links", () => {
  test("inspect the Evals library and Activity links", async ({ page }) => {
    // 1. Evals library
    await page.goto("/companies/insight/evals");
    
    // Check if Evals library loads
    await expect(page.getByRole("heading", { name: "Evals" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Library Filters")).toBeVisible();
    await expect(page.getByText("Saved Cases")).toBeVisible();

    // Screenshot Evals library
    await page.screenshot({ path: "scratch/ins-228-evals-library.png", fullPage: true });

    // 2. Activity links
    await page.goto("/companies/insight/activity");
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible({ timeout: 15_000 });
    
    // Screenshot activity
    await page.screenshot({ path: "scratch/ins-228-activity.png", fullPage: true });
  });
});
