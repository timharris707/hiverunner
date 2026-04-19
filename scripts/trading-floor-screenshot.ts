import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const MC_BASE_URL = process.env.MC_BASE_URL || "http://127.0.0.1:3010";

const dir = join(process.cwd(), "artifacts", "trading-floor-parity");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const pageFile = join(dir, `trading-floor-page-${stamp}.png`);
const tableFile = join(dir, `trading-floor-open-table-${stamp}.png`);

async function main() {
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

  await page.screenshot({ path: pageFile, fullPage: true });

  const table = page.locator("table").first();
  if (await table.count()) {
    await table.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await table.screenshot({ path: tableFile });
  }

  await browser.close();

  console.log(pageFile);
  console.log(tableFile);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
