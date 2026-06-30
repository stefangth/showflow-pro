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
  // A JSONB-null-valued row (org override or platform default) is not a "real"
  // value — fall through to the next tier instead of returning null.
  const chosen = [orgRow, platformRow].find((r) => r && r.value != null);
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

/**
 * Reduce a batched `app_settings` read (multiple keys, org rows + platform defaults mixed)
 * to the effective row per key: the org's own row (org_id = the org) wins over the platform
 * default (org_id IS NULL). The canonical "org row wins" resolver shared by every multi-key
 * reader (SettingsPage, fetchAirtableSettings) so the rule lives in one place.
 */
export function mergeOrgRows(
  rows: { key: string; value: unknown; org_id: string | null }[],
): Map<string, { value: unknown; org_id: string | null }> {
  const byKey = new Map<string, { value: unknown; org_id: string | null }>();
  for (const r of rows) {
    // A JSONB-null-valued row is not a "real" value — skip it, same as resolveOrgSetting,
    // so a null-valued org row falls through to a real-valued platform row instead of winning.
    if (r.value == null) continue;
    const prev = byKey.get(r.key);
    if (!prev || (r.org_id !== null && prev.org_id === null)) byKey.set(r.key, { value: r.value, org_id: r.org_id });
  }
  return byKey;
}

export interface ShowLink extends ShowWithSlots { airtable_program_key: string | null }

/** Org's shows with slots + Airtable link key, for the catalog-linking UI. */
export async function fetchShowsForLinking(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowLink[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("shows")
    .select("id, program, sub_program, main_cast_slots, understudy_slots, airtable_program_key")
    .eq("org_id", orgId).order("program").order("sub_program");
  if (error) throw error;
  return (data ?? []) as ShowLink[];
}

/** Link (or, with null, unlink) a show to an Airtable program-option key. */
export async function linkShowAirtableKey(
  client: SupabaseClient<Database>,
  showId: string,
  key: string | null,
): Promise<void> {
  const { error } = await client.from("shows").update({ airtable_program_key: key }).eq("id", showId);
  if (error) throw error;
}

/** Bulk-create shows from Airtable Program options. Slots start NULL ("needs config"); status active.
 *  Pass only unlinked options (caller dedupes against existing airtable_program_key). */
export async function importShowsFromOptions(
  client: SupabaseClient<Database>,
  orgId: string,
  rows: Array<{ program: string | null; sub_program: string | null; key: string }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await client.from("shows").insert(
    rows.map((r) => ({
      org_id: orgId, program: r.program, sub_program: r.sub_program,
      airtable_program_key: r.key, main_cast_slots: null, understudy_slots: null, status: "active" as const,
    })),
  );
  if (error) throw error;
}
