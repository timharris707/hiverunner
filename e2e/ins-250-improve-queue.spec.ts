import fs from "node:fs";

import { expect, test } from "@playwright/test";

const artifactDir = process.env.HIVERUNNER_BROWSER_PROOF_ARTIFACT_DIR || "output/playwright/ins-250";

test.beforeAll(() => {
  fs.mkdirSync(artifactDir, { recursive: true });
});

function collectConsoleIssues(page: import("@playwright/test").Page): string[] {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("__nextjs_original-stack-frames")) issues.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (!error.message.includes("__nextjs_original-stack-frames")) issues.push(error.message);
  });
  return issues;
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function openImproveQueue(page: import("@playwright/test").Page) {
  await page.goto("about:blank");
  await page.goto("/INS/improve");
  await expect(page.locator("[data-improve-queue]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Improve" })).toBeVisible();
}

test.describe("INS-250 Improve queue UI and navigation", () => {
  test.use({ viewport: { width: 1320, height: 900 } });

  test("renders queue states, filters, evidence, and actions without desktop overlap", async ({ page }) => {
    const consoleIssues = collectConsoleIssues(page);

    await page.goto("/companies/insight/dashboard");
    const improveLink = page.getByRole("link", { name: "Improve" }).first();
    await expect(improveLink).toBeVisible({ timeout: 15_000 });
    await expect(improveLink).toHaveAttribute("href", "/INS/improve");
    await improveLink.click();
    await expect(page.locator("[data-improve-queue]")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/improve(?:\?|$)/, { timeout: 15_000 });
    await expect(page.locator("[data-improve-recommendation]")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("[data-improve-evidence-preview]")).toBeVisible();
    await expect(page.getByText("Evidence Preview")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${artifactDir}/desktop-initial.png`, fullPage: true });

    await page.getByRole("tab", { name: /^All\b/ }).click();
    await page.getByLabel("Suppression").selectOption("all");
    await expect(page.locator("[data-improve-recommendation]")).toHaveCount(6);

    await page.getByLabel("Trigger").selectOption("repeated_review_return");
    await page.getByLabel("Severity").selectOption("high");
    await page.getByLabel("Confidence").selectOption("high");
    await expect(page.locator("[data-improve-recommendation]")).toHaveCount(2);
    await page.waitForTimeout(500); // Give Next.js router time to settle
    await page.screenshot({ path: `${artifactDir}/desktop-filtered.png`, fullPage: true });

    await page.getByPlaceholder("Agent, trigger, scope").fill("does-not-exist");
    await expect(page.getByText("No recommendations match these filters.")).toBeVisible();

    await page.getByRole("button", { name: /^Clear$/ }).click();
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toBeVisible();

    await page.getByRole("button", { name: "Edit recommendation" }).click();
    await page.getByLabel("Proposed change").fill("Require browser proof and console health for Improve queue work.");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toContainText(
      "Require browser proof and console health for Improve queue work.",
    );

    await page.getByRole("button", { name: "Accept for approval" }).click();
    await page.getByRole("tab", { name: /^Accepted For Approval\b/ }).click();
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toBeVisible();

    // improve-1 was just accepted, so it left the default Suggested tab; the All
    // tab surfaces it regardless of status before we suppress it.
    await openImproveQueue(page);
    await page.getByRole("tab", { name: /^All\b/ }).click();
    await page.locator("[data-improve-recommendation='improve-1']").click();
    await page.getByRole("button", { name: "Suppress" }).click();
    await page.getByLabel("Suppression").selectOption("suppressed");
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toBeVisible();
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toContainText("suppressed");

    // improve-1 is now suppressed; All tab + suppression=all keeps it findable to dismiss.
    await openImproveQueue(page);
    await page.getByRole("tab", { name: /^All\b/ }).click();
    await page.getByLabel("Suppression").selectOption("all");
    await page.locator("[data-improve-recommendation='improve-1']").click();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await page.getByLabel("Dismissal category").selectOption("wrong_diagnosis");
    await page.getByLabel("Optional notes").fill("Reviewer evidence points elsewhere.");
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await page.getByRole("tab", { name: /^Dismissed\b/ }).click();
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toBeVisible();
    await page.screenshot({ path: `${artifactDir}/desktop-actions.png`, fullPage: true });

    await expectNoHorizontalOverflow(page);
    expect(consoleIssues).toEqual([]);
  });

  test("keeps the queue usable on mobile without horizontal overflow", async ({ page }) => {
    const consoleIssues = collectConsoleIssues(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openImproveQueue(page);

    // The desktop test above mutates improve-1's status; the All tab with
    // suppression=all keeps the mobile layout check independent of that state.
    await page.getByRole("tab", { name: /^All\b/ }).click();
    await page.getByLabel("Suppression").selectOption("all");
    await expect(page.locator("[data-improve-recommendation='improve-1']")).toBeVisible();
    await expect(page.locator("[data-improve-evidence-preview]")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${artifactDir}/mobile-queue.png`, fullPage: true });

    expect(consoleIssues).toEqual([]);
  });
});
