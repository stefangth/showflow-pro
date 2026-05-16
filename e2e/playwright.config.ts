import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Showflow Pro.
 *
 * Tests run against a live dev server (or a deployed preview URL).
 * Set PLAYWRIGHT_BASE_URL to override the default localhost target.
 *
 * Designed for CI: only runs on PRs to main (configured in .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: "./",
  testMatch: "**/*.spec.ts",
  fullyParallel: false, // signup/approval tests share state — run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    headless: true,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the dev server automatically when running locally (not in CI).
  // In CI the server is started by the workflow before tests run.
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
