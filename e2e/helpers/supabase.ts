/**
 * Supabase admin client factory for E2E tests.
 *
 * Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to bypass RLS for test setup
 * and teardown. Never use this from app code — only from E2E helpers.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "E2E: SUPABASE_URL (or VITE_SUPABASE_URL) is required for admin operations"
    );
  }
  if (!serviceKey) {
    throw new Error(
      "E2E: SUPABASE_SERVICE_ROLE_KEY is required for admin operations"
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Unique tag used in display_name/email of seeded accounts so cleanup can find them. */
export const E2E_TAG = "e2e";

/** Generate a deterministic-per-run email like e2e-artist-1700000000@showflowpro.test */
export function tagEmail(role: string, suffix: string | number): string {
  return `${E2E_TAG}-${role}-${suffix}@showflowpro.test`;
}
