import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E smoke suite — Mission Control
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

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
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

  // When BASE_URL points to a remote preview, skip starting a local server
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        env: {
          ...process.env,
          MISSION_CONTROL_E2E_BUILD_STUB: "1",
        },
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
