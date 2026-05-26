import { defineConfig, devices } from "@playwright/test";

// Set once per test run before any workers start; all module evaluations
// in the same worker process will read the same value via process.env.
process.env.PLAYWRIGHT_RUN_ID ??= String(Date.now());

/**
 * Playwright E2E smoke suite — HiveRunner
 * Runs against the local dev server on both Chromium and WebKit.
 *
 * Usage:
 *   npm run test:e2e               # headless, both browsers
 *   npm run test:e2e -- --headed   # with browser window
 *   npm run test:e2e -- --project=chromium
 */
export default defineConfig({
  testDir: "./e2e",

  // Serial execution avoids data races on the shared tasks.json file
  fullyParallel: false,
  workers: 1,

  // 60 s per test — board has a 5 s polling loop that can slow click-stability checks
  timeout: 60_000,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3010",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  // When BASE_URL points to an already-running server, skip starting a local server.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        env: {
          ...process.env,
          HIVERUNNER_E2E_BUILD_STUB: "1",
        },
        url: "http://localhost:3010",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
