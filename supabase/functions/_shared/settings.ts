import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** A row of the app_settings table as the resolver reads it. */
interface SettingRow { org_id: string | null; value: unknown }

/**
 * Canonical fallback defaults for the org-tunable booking-engine settings.
 * Mirrors the frontend `src/config/app.config.ts` BOOKING_ENGINE_DEFAULTS — the
 * two runtimes can't share an import, so keep them in sync. An org override or a
 * platform default wins via resolveOrgSetting; these are the last-resort fallback.
 */
export const BOOKING_ENGINE_DEFAULTS = {
  offer_response_window_hours: 48,
  offer_digest_hour_berlin: 19,
  confirmation_digest_hour_berlin: 20,
  resend_from_address: "ShowFlow <noreply@showflow.pro>",
} as const;

/**
 * Effective value for a setting: the org's own row if present, else the platform
 * default (org_id IS NULL), else `fallback`. One round-trip. Mirrors the SQL
 * get_org_setting() and the frontend src/data/settings.ts:resolveOrgSetting().
 * When orgId is null, only the platform default is consulted.
 */
export async function resolveOrgSetting<T>(
  admin: SupabaseClient,
  orgId: string | null,
  key: string,
  fallback: T,
): Promise<T> {
  let q = admin.from("app_settings").select("org_id, value").eq("key", key);
  q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is("org_id", null);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as SettingRow[];
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  // A JSONB-null-valued row (org override or platform default) is not a "real"
  // value — fall through to the next tier instead of returning null.
  const chosen = [orgRow, platformRow].find((r) => r && r.value != null);
  return chosen ? (chosen.value as T) : fallback;
}

/** Active organizations (status = 'active'). The set every cron loop iterates. */
export async function getActiveOrgs(admin: SupabaseClient): Promise<Array<{ id: string }>> {
  const { data, error } = await admin
    .from("organizations").select("id").eq("status", "active");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string }>;
}
