import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Load the generated local-stack env (`.env.development.local`, written by
 * `npm run local:up`) so global-setup.ts sees SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY when running against the local database — without the
 * developer exporting them by hand. Only fills keys that are not already set, so
 * CI (which injects these via GITHUB_ENV and has no such file) is unaffected.
 */
function loadLocalEnv(): void {
  const path = resolve(process.cwd(), ".env.development.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadLocalEnv();

/**
 * Playwright E2E configuration for Showflow Pro.
 *
 * Cross-stack specs (auto-discovered):
 *   - booking-lifecycle.spec.ts
 *   - chat-access-control.spec.ts
 *   - eligibility-gating.spec.ts
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
  // Retry once locally too, not just in CI. Cross-stack e2e has irreducible
  // transient flakes — cold Vite first-compile, sonner toast timing, stack
  // warmup — and `verify:full` exists to mirror CI ("green here ≈ green in CI").
  // With local retries at 0, a single blip diverged local from CI (which retries),
  // so keep the retry policy identical on both.
  retries: 1,
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
