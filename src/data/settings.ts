import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { NestedSlotDefaults } from "@/hooks/useSubProgramSlots";
import { dedupeProgramPairs, type ProgramPair } from "@/lib/settings";

/** Distinct (program, sub_program) pairs across all shows. */
export async function fetchProgramSubProgramPairs(
  client: SupabaseClient<Database>,
): Promise<ProgramPair[]> {
  const { data, error } = await client
    .from("shows")
    .select("program, sub_program")
    .not("program", "is", null)
    .not("sub_program", "is", null);
  if (error) throw error;
  return dedupeProgramPairs(data ?? []);
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

/** The sub_program_slots_defaults effective for an org (or {}). */
export async function fetchSlotDefaults(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<NestedSlotDefaults> {
  return resolveOrgSetting<NestedSlotDefaults>(client, orgId, "sub_program_slots_defaults", {});
}
