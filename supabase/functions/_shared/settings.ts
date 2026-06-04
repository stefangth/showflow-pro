import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** A row of the app_settings table as the resolver reads it. */
interface SettingRow { org_id: string | null; value: unknown }

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
  const chosen = orgRow ?? platformRow;
  return chosen ? (chosen.value as T) : fallback;
}

/** Active organizations (status = 'active'). The set every cron loop iterates. */
export async function getActiveOrgs(admin: SupabaseClient): Promise<Array<{ id: string }>> {
  const { data, error } = await admin
    .from("organizations").select("id").eq("status", "active");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string }>;
}
