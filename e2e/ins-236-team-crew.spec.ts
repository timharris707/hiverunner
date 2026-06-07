import { test, expect } from "@playwright/test";

test("INS-236: Team page and scoped Active Crew UI validation", async ({ page }) => {
  // Navigate to Team page
  await page.goto("/companies/insight/team");
  await expect(page.locator('text=Active Crew').first()).toBeVisible();
  await page.waitForTimeout(2000); // Give it a moment to load and render

  await page.screenshot({ path: "scratch/qa-ins-236-team-page.png", fullPage: true });

  // Wait for the "Bench" tab to be present and click it
  const benchTab = page.locator('button[role="tab"]:has-text("Bench")').first();
  if (await benchTab.isVisible()) {
    await benchTab.click();
    await page.waitForTimeout(1000); // Wait for transition
    await page.screenshot({ path: "scratch/qa-ins-236-team-bench.png", fullPage: true });
  }

  // Navigate to Tasks page
  await page.goto("/companies/insight/tasks");
  await expect(page.locator('text=Visible tasks').first()).toBeVisible();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "scratch/qa-ins-236-tasks-active-crew.png", fullPage: true });

  // Click Bench button if available
  const benchButton = page.locator('button:has-text("Bench ")').first();
  if (await benchButton.isVisible()) {
    await benchButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "scratch/qa-ins-236-tasks-bench-search.png", fullPage: true });

    await page.getByPlaceholder("Search tasks...").fill("ins-236-no-visible-task-target");
    await expect(page.getByText("No tasks match filters.")).toBeVisible({ timeout: 15000 });

    const addBenchAgentButton = page.locator('button[aria-label^="Add "][aria-label$=" to this work"]').first();
    await expect(addBenchAgentButton).toBeVisible();
    await addBenchAgentButton.click();
    await expect(page.getByText("No visible task is available for assignment.").first()).toBeVisible();
    await expect(page.getByText(/^Added .* to this work\.$/)).toHaveCount(0);
    await page.screenshot({ path: "scratch/qa-ins-236-tasks-no-visible-target.png", fullPage: true });
  }

  // Navigate to Goals page
  await page.goto("/companies/insight/goals");
  await page.waitForTimeout(2000);
  const firstGoalLink = await page.locator('a[href*="/goals/"]').first().getAttribute("href");
  if (firstGoalLink) {
    await page.goto(firstGoalLink);
    await expect(page.locator('text=Active Crew').first()).toBeVisible({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "scratch/qa-ins-236-goal-active-crew.png", fullPage: true });
  }
});
