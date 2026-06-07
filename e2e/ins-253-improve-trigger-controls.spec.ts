import { test, expect } from "@playwright/test";

const artifactDir = process.env.HIVERUNNER_BROWSER_PROOF_ARTIFACT_DIR || "scratch";

test.use({ viewport: { width: 1320, height: 900 }, video: "on" });

test("Improve queue trigger controls and suppression", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", msg => {
    if (msg.type() === "error") logs.push(msg.text());
  });

  await page.goto("http://localhost:3010/companies/insight/improve?status=all&suppression=all");

  await expect(page.locator("[data-improve-queue]")).toBeVisible();
  await expect(page.locator("[data-improve-trigger]")).toHaveCount(7);

  // Test Pause automation
  const pauseAutomation = page.locator("button:has-text('Pause automation')");
  const resumeAutomation = page.locator("button:has-text('Resume automation')");
  if (await resumeAutomation.isVisible()) {
    await resumeAutomation.click();
    await expect(pauseAutomation).toBeVisible();
  }
  await pauseAutomation.click();
  await expect(page.locator("button:has-text('Resume automation')")).toBeVisible();

  // Test Disable a specific trigger
  const missingCapability = page.locator("[data-improve-trigger='missing_capability']");
  const pauseMissingCapability = missingCapability.locator("button:has-text('Pause')");
  const resumeMissingCapability = missingCapability.locator("button:has-text('Resume')");
  if (await resumeMissingCapability.isVisible()) {
    await resumeMissingCapability.click();
    await expect(pauseMissingCapability).toBeVisible();
  }
  await pauseMissingCapability.click();
  await expect(resumeMissingCapability).toBeVisible();

  // Select a recommendation
  const recommendation = page.locator("[data-improve-recommendation]").first();
  await expect(recommendation).toBeVisible();
  const recommendationId = await recommendation.getAttribute("data-improve-recommendation");
  if (!recommendationId) throw new Error("Expected selected recommendation to expose a stable id");
  await recommendation.click();

  // Test Suppress action
  await page.getByRole("button", { name: "Suppress", exact: true }).click();

  await expect(page.locator("[data-improve-trigger-firings]")).toBeVisible();

  // Now change filters to Suppressed only to see the suppressed item
  await page.getByLabel("Suppression").selectOption("suppressed");
  await expect(page.getByLabel("Suppression")).toHaveValue("suppressed");
  await expect(page.locator(`[data-improve-recommendation='${recommendationId}']`)).toBeVisible();

  // Take a screenshot
  await page.screenshot({ path: `${artifactDir}/ins-253-suppression.png`, fullPage: true });

  await page.waitForTimeout(1000);

  expect(logs.filter(l => l.includes('Hydration'))).toHaveLength(0);
});
