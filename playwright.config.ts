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
    baseURL: "http://localhost:3000",
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

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true, // reuse running dev server in local dev
    timeout: 120_000,
  },
});
