import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AirtableFieldMap } from "./airtableMapping";
import { mergeOrgRows } from "./settings";

/** The Airtable settings the admin edits in the Airtable Sync tab. */
export interface AirtableSettings {
  airtable_sync_enabled: boolean;
  airtable_base_id: string;
  airtable_table_name: string;
  airtable_field_map: AirtableFieldMap;
  /** Airtable view the poll reads from. Blank = whole table; defaults to "Grid view". */
  airtable_view: string;
}

export const AIRTABLE_SETTING_KEYS = [
  "airtable_sync_enabled",
  "airtable_base_id",
  "airtable_table_name",
  "airtable_field_map",
  "airtable_view",
] as const;

const DEFAULTS: AirtableSettings = {
  airtable_sync_enabled: false,
  airtable_base_id: "",
  airtable_table_name: "",
  airtable_field_map: {},
  airtable_view: "Grid view",
};

/**
 * Read the org's effective Airtable settings in one round-trip. The org's own
 * row wins over the platform default (org_id IS NULL) per key; missing keys fall
 * back to typed defaults. Mirrors the per-key resolution in SettingsPage.
 */
export async function fetchAirtableSettings(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<AirtableSettings> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value, org_id")
    .in("key", AIRTABLE_SETTING_KEYS as unknown as string[])
    .or(`org_id.eq.${orgId},org_id.is.null`);
  if (error) throw error;

  const byKey = mergeOrgRows((data ?? []) as { key: string; value: unknown; org_id: string | null }[]);

  return {
    airtable_sync_enabled: (byKey.get("airtable_sync_enabled")?.value as boolean) ?? DEFAULTS.airtable_sync_enabled,
    airtable_base_id: (byKey.get("airtable_base_id")?.value as string) ?? DEFAULTS.airtable_base_id,
    airtable_table_name: (byKey.get("airtable_table_name")?.value as string) ?? DEFAULTS.airtable_table_name,
    airtable_field_map: (byKey.get("airtable_field_map")?.value as AirtableFieldMap) ?? DEFAULTS.airtable_field_map,
    // An explicit "" (read the whole table) is preserved; only a missing row falls back.
    airtable_view: (byKey.get("airtable_view")?.value as string) ?? DEFAULTS.airtable_view,
  };
}
