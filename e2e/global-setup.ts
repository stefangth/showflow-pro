/**
 * Playwright global setup. Runs once before any test.
 *
 *  - Validates required env vars
 *  - Ensures the test admin / producer / artist accounts exist and are approved
 *    with the right roles. Passwords are reset to the values from env on every run.
 *
 * If `SUPABASE_SERVICE_ROLE_KEY` is missing we exit non-zero — these tests cannot
 * run without it. CI must provide it via secrets.
 */
import { ensureUserWithRole } from "./helpers/users";

export const TEST_ADMIN_EMAIL =
  process.env.PLAYWRIGHT_ADMIN_EMAIL ?? "e2e-admin@showflowpro.test";
export const TEST_ADMIN_PASSWORD =
  process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? "E2eAdminPass!1";
export const TEST_PRODUCER_EMAIL =
  process.env.PLAYWRIGHT_PRODUCER_EMAIL ?? "e2e-producer@showflowpro.test";
export const TEST_PRODUCER_PASSWORD =
  process.env.PLAYWRIGHT_PRODUCER_PASSWORD ?? "E2eProducerPass!1";

export default async function globalSetup(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "E2E global setup: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
    );
  }

  await ensureUserWithRole(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, "admin");
  await ensureUserWithRole(TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD, "producer");
}
