import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration for Showflow Pro.
 *
 * Two happy-path specs:
 *   - signup-approval.spec.ts — Flow A
 *   - booking-lifecycle.spec.ts — Flow B
 *
 * Required env (set by CI from secrets):
 *   SUPABASE_URL                  — Supabase project URL the dev server points at
 *   SUPABASE_SERVICE_ROLE_KEY     — used by helpers for setup/teardown (NEVER ship to client)
 *   PLAYWRIGHT_BASE_URL           — defaults to http://localhost:5173
 *
 * The job in .github/workflows/ci.yml only runs on pull requests targeting `main`.
 */
export default defineConfig({
  testDir: "./",
  testMatch: "**/*.spec.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
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

  // Locally we start the dev server automatically (vite is configured for 8080
  // in vite.config.ts). In CI the workflow starts Supabase + a vite preview
  // server before invoking playwright.
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:8080",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
