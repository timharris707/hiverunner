import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const MC_BASE_URL = process.env.MC_BASE_URL || "http://127.0.0.1:3010";

async function main() {
  const dir = join(process.cwd(), "artifacts", "trading-floor-parity");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });

  const positionsLoaded = page.waitForResponse(
    (res) => res.url().includes("/api/trading/kalshi-positions") && res.status() === 200,
    { timeout: 240000 },
  );

  await page.goto(`${MC_BASE_URL}/trading/floor`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await positionsLoaded;
  await page.waitForTimeout(3000);

  const viewportFile = join(dir, `trading-floor-now-viewport-${stamp}.png`);
  await page.screenshot({ path: viewportFile });
  console.log(viewportFile);

  const rowCards = page.locator("button:has-text('Payout if Win')");
  const count = await rowCards.count();
  const limit = Math.min(count, 8);

  for (let i = 0; i < limit; i += 1) {
    const file = join(dir, `trading-floor-now-row-${String(i + 1).padStart(2, "0")}-${stamp}.png`);
    await rowCards.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await rowCards.nth(i).screenshot({ path: file });
    console.log(file);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
