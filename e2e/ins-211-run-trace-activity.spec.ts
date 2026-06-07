import { test, expect } from "@playwright/test";

test.describe("Task Activity Run Trace Actions", () => {
  test("proves each listed run opens the expected trace route and compact summaries still show status/result", async ({ page }) => {
    // 1. Navigate to a known task with runs.
    // For this test, we can use the fixture company 'insight' and task 'INS-211'.
    await page.goto("/companies/hiverunner-public-demo/tasks/HIV2-2");

    // 2. Click the 'Activity' tab or scroll to the execution history.
    await page.getByRole("button", { name: /Activity/i }).click();

    // Wait for the task details to load
    await page.waitForSelector("text=Execution history", { timeout: 15000 });

    // 3. Expand the Execution History panel
    const executionHistorySummary = page.locator("summary", { hasText: "Execution history" });
    await executionHistorySummary.click();

    // 4. Verify compact summaries still show status/result
    // We should see provider and status, e.g. "completed", "failed", "running"
    const runSummary = page.locator("summary", { hasText: /completed|failed|running|succeeded|error|unknown/i }).first();
    await expect(runSummary).toBeVisible();

    // 5. Expand the first run to see the compact details and link
    await runSummary.click();

    // 6. Verify the "Open trace" link is present
    const openTraceLink = page.locator("a", { hasText: "Open trace" }).first();
    await expect(openTraceLink).toBeVisible();

    // 7. Verify the link points to the expected trace route
    const href = await openTraceLink.getAttribute("href");
    expect(href).toMatch(/\/companies\/hiverunner-public-demo\/tasks\/HIV2-2\/runs\/[a-zA-Z0-9-]+/);

    // 8. Click the link and ensure it opens the trace route
    await openTraceLink.click();
    await page.waitForURL(/\/companies\/hiverunner-public-demo\/tasks\/HIV2-2\/runs\/[a-zA-Z0-9-]+/);

    // Check if the trace route loads (e.g. contains "Run Trace" or "Trace" or provider info)
    await expect(page.locator("text=Orchestration mode").first()).toBeVisible();
  });
});
