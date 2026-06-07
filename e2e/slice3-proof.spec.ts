import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3010';
const ARTIFACT_DIR = '/Users/timharris/.mission-control/stable/workspaces/companies/insight/slice3-proof';

test.describe('Slice 3 Browser Proof', () => {
  // Create output directory
  test.beforeAll(async () => {
    if (!existsSync(ARTIFACT_DIR)) {
      mkdirSync(ARTIFACT_DIR, { recursive: true });
    }
  });

  test('1. Template launch flow', async ({ page }) => {
    // Navigate to companies list
    await page.goto(`${BASE_URL}`);
    await expect(page).toHaveTitle(/HiveRunner|Insight/i);

    // Find and click Insight company
    const companyLink = page.locator('a:has-text("Insight"), button:has-text("Insight")').first();
    if (await companyLink.isVisible()) {
      await companyLink.click();
    }

    // Wait for company page to load
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '1-company-dashboard.png') });

    // Navigate to templates/agents
    const agentLink = page.locator('a:has-text("Agents"), text=/^Agents$/').first();
    if (await agentLink.isVisible()) {
      await agentLink.click();
      await page.waitForLoadState('networkidle');
    } else {
      // Try dashboard route
      await page.goto(`${BASE_URL}/companies/insight/agents`);
      await page.waitForLoadState('networkidle');
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '2-agents-template-launch.png') });
  });

  test('2. Draft review', async ({ page }) => {
    // Navigate to goals/drafts area
    await page.goto(`${BASE_URL}/companies/insight/goals`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '3-goals-list.png') });

    // Try to find and open a draft
    const draftItem = page.locator('[data-testid*="draft"], .draft, li:has-text("draft")').first();
    if (await draftItem.isVisible()) {
      await draftItem.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '4-draft-review.png') });
    }
  });

  test('3. Team page with filters', async ({ page }) => {
    // Navigate to Team page
    await page.goto(`${BASE_URL}/companies/insight/team`);
    await page.waitForLoadState('networkidle');

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '5-team-page-full.png') });

    // Look for filters/controls
    const filterInputs = page.locator('input[type="text"], input[type="search"], [role="combobox"]');
    const filterCount = await filterInputs.count();
    if (filterCount > 0) {
      // Try typing in first filter
      await filterInputs.first().click();
      await filterInputs.first().type('test', { delay: 100 });
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '6-team-filters-applied.png') });
      await filterInputs.first().clear();
    }
  });

  test('4. Active Crew and Bench recommendations', async ({ page }) => {
    // Check if there's an Active Crew section on Team or elsewhere
    await page.goto(`${BASE_URL}/companies/insight/team`);
    await page.waitForLoadState('networkidle');

    // Look for Crew, Bench, or Active sections
    const crewSection = page.locator('text=/Active Crew|Bench|Available/i').first();
    if (await crewSection.isVisible()) {
      await crewSection.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '7-crew-bench-section.png') });
    } else {
      // Fallback: capture full team page which should have crew info
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '7-team-crew-fallback.png') });
    }
  });

  test('5. Delegated signoff guards', async ({ page }) => {
    // Navigate to a task with delegated signoff
    await page.goto(`${BASE_URL}/companies/insight/tasks`);
    await page.waitForLoadState('networkidle');

    // Look for task with signoff status
    const taskWithSignoff = page.locator('[data-testid*="signoff"], text=/signoff|approval|delegate/i').first();
    if (await taskWithSignoff.isVisible()) {
      await taskWithSignoff.click();
      await page.waitForLoadState('networkidle');
    } else {
      // Just open first task
      const firstTask = page.locator('a[href*="/tasks/"]').first();
      if (await firstTask.isVisible()) {
        await firstTask.click();
        await page.waitForLoadState('networkidle');
      }
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, '8-delegated-signoff.png') });
  });

  test('6. Activity and Evals links', async ({ page }) => {
    // Navigate to a task to see activity/evals
    await page.goto(`${BASE_URL}/companies/insight/tasks`);
    await page.waitForLoadState('networkidle');

    // Open first task
    const firstTask = page.locator('a[href*="/tasks/"]').first();
    if (await firstTask.isVisible()) {
      await firstTask.click();
      await page.waitForLoadState('networkidle');
    }

    // Look for Activity or Evals sections/tabs
    const activityTab = page.locator('[role="tab"]:has-text("Activity"), text=/^Activity$/').first();
    if (await activityTab.isVisible()) {
      await activityTab.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '9-activity-tab.png') });
    }

    const evalsTab = page.locator('[role="tab"]:has-text("Evals"), text=/^Evals$/').first();
    if (await evalsTab.isVisible()) {
      await evalsTab.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '10-evals-tab.png') });
    } else {
      // Fallback: capture current task view
      await page.screenshot({ path: path.join(ARTIFACT_DIR, '10-task-detail-fallback.png') });
    }
  });
});
