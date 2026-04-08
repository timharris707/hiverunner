const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    console.log("Navigating to target...");
    const response = await page.goto('http://127.0.0.1:3010/NEV/projects/mission-control-orchestration/tasks', { timeout: 15000 });
    console.log("Status:", response.status());
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    const content = await page.content();
    console.log("Snippet:", content.substring(0, 300));
  } catch (e) {
    console.error("Playwright Error:", e.message);
  } finally {
    await browser.close();
  }
})();