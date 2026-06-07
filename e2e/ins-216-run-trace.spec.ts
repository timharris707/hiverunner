import { test, expect } from '@playwright/test';

test('Run Trace Verification', async ({ page }) => {
  // Task Page
  await page.goto('http://localhost:3010/companies/hiverunner-public-demo/tasks/HIV2-2');
  await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'scratch/task-page-runs.png', fullPage: true });

  // 1. Completed run (Verify export controls and annotations)
  await page.goto('http://localhost:3010/companies/hiverunner-public-demo/tasks/HIV2-2/runs/bd3771fc-957e-4316-a750-26855b1abeab');
  await expect(page.getByText(/Redacted JSON/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/annotation/i).first()).toBeVisible();
  await page.screenshot({ path: 'scratch/completed-run.png', fullPage: true });

  // 2. Failed run
  await page.goto('http://localhost:3010/companies/hiverunner-public-demo/tasks/HIV2-1/runs/6d2650a2-9f0e-43f1-b81e-4408cf01f070');
  await expect(page.getByText(/Failed/i).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'scratch/failed-run.png', fullPage: true });

  // 3. Cancelled/Symphony run (minimal run)
  await page.goto('http://localhost:3010/companies/hiverunner-public-demo/tasks/HIV2-4/runs/1d10f5b4-8c9b-480d-a5a4-d28f4a4be864');
  await expect(page.getByText(/Cancelled/i).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'scratch/cancelled-run.png', fullPage: true });
});
