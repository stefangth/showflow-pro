import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export interface ShowWithSlots {
  id: string;
  program: string | null;
  sub_program: string | null;
  main_cast_slots: number | null;
  understudy_slots: number | null;
}

/** Fetch all shows for an org with their slot columns, ordered by program then sub_program. */
export async function fetchShowsWithSlots(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowWithSlots[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("shows")
    .select("id, program, sub_program, main_cast_slots, understudy_slots")
    .eq("org_id", orgId)
    .order("program")
    .order("sub_program");
  if (error) throw error;
  return (data ?? []) as ShowWithSlots[];
}

/** Update slot columns on a single show. Pass null to clear a column. */
export async function updateShowSlots(
  client: SupabaseClient<Database>,
  showId: string,
  mainCast: number | null,
  understudies: number | null,
): Promise<void> {
  const { error } = await client
    .from("shows")
    .update({ main_cast_slots: mainCast, understudy_slots: understudies })
    .eq("id", showId);
  if (error) throw error;
}

interface SettingRow { org_id: string | null; value: unknown }

/**
 * Effective value for a setting: the org's own row if present, else the platform
 * default (org_id IS NULL), else `fallback`. One round-trip. Mirrors get_org_setting()
 * in the DB. When orgId is null, only the platform default is consulted.
 */
export async function resolveOrgSetting<T>(
  client: SupabaseClient<Database>,
  orgId: string | null,
  key: string,
  fallback: T,
): Promise<T> {
  let q = client.from("app_settings").select("org_id, value").eq("key", key);
  q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is("org_id", null);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as SettingRow[];
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  const chosen = orgRow ?? platformRow;
  return (chosen ? (chosen.value as T) : fallback);
}

/** Upsert a per-org setting override (org_id,key). Platform defaults are super-admin-only. */
export async function upsertOrgSetting(
  client: SupabaseClient<Database>,
  orgId: string,
  key: string,
  value: Json,
): Promise<void> {
  const { error } = await client
    .from("app_settings")
    .upsert({ org_id: orgId, key, value }, { onConflict: "org_id,key" });
  if (error) throw error;
}
