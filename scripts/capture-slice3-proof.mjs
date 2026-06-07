#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'http://localhost:3010';
const ARTIFACT_DIR = '/Users/timharris/.mission-control/stable/workspaces/companies/insight/slice3-proof';

mkdirSync(ARTIFACT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    console.log('1. Navigating to dashboard...');
    await page.goto(`${BASE_URL}/companies/insight/tasks`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.screenshot({ path: join(ARTIFACT_DIR, '1-dashboard.png') });
    console.log('   ✓ Saved: 1-dashboard.png');

    console.log('2. Navigating to Insight company...');
    const companyBtn = page.locator('a:has-text("Insight")').first();
    if (await companyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await companyBtn.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: join(ARTIFACT_DIR, '2-insight-dashboard.png') });
      console.log('   ✓ Saved: 2-insight-dashboard.png');
    }

    console.log('3. Navigating to Agents (templates)...');
    await page.goto(`${BASE_URL}/companies/insight/agents`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(ARTIFACT_DIR, '3-agents-template-launch.png') });
    console.log('   ✓ Saved: 3-agents-template-launch.png');

    console.log('4. Navigating to Goals (drafts)...');
    await page.goto(`${BASE_URL}/companies/insight/goals`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(ARTIFACT_DIR, '4-goals-drafts.png') });
    console.log('   ✓ Saved: 4-goals-drafts.png');

    console.log('5. Navigating to Team page...');
    await page.goto(`${BASE_URL}/companies/insight/team`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(ARTIFACT_DIR, '5-team-page.png') });

    // Try to interact with filters
    const filterInputs = page.locator('input[type="text"], [role="combobox"]');
    const count = await filterInputs.count().catch(() => 0);
    if (count > 0) {
      await filterInputs.first().click().catch(() => {});
      await page.type('text', 'test', { delay: 50 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: join(ARTIFACT_DIR, '6-team-filters.png') });
      console.log('   ✓ Saved: 5-team-page.png, 6-team-filters.png');
    } else {
      console.log('   ✓ Saved: 5-team-page.png');
    }

    console.log('7. Navigating to Tasks...');
    await page.goto(`${BASE_URL}/companies/insight/tasks`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(ARTIFACT_DIR, '7-tasks-list.png') });
    console.log('   ✓ Saved: 7-tasks-list.png');

    // Try to open first task
    const taskLink = page.locator('a[href*="/tasks/"]').first();
    if (await taskLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await taskLink.click();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: join(ARTIFACT_DIR, '8-task-detail.png') });

      // Look for Activity/Evals tabs
      const activityTab = page.locator('[role="tab"]:has-text("Activity"), text=/Activity/i').first();
      if (await activityTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await activityTab.click();
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: join(ARTIFACT_DIR, '9-activity-tab.png') });
        console.log('   ✓ Saved: 8-task-detail.png, 9-activity-tab.png');
      } else {
        console.log('   ✓ Saved: 8-task-detail.png');
      }
    }

    console.log('\n✅ All screenshots captured successfully');
    console.log(`Artifacts saved to: ${ARTIFACT_DIR}`);
  } catch (error) {
    console.error('Error during capture:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
