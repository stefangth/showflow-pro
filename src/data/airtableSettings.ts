import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AirtableFieldMap } from "./airtableMapping";

/** The four Airtable settings the admin edits in the Airtable Sync tab. */
export interface AirtableSettings {
  airtable_sync_enabled: boolean;
  airtable_base_id: string;
  airtable_table_name: string;
  airtable_field_map: AirtableFieldMap;
}

export const AIRTABLE_SETTING_KEYS = [
  "airtable_sync_enabled",
  "airtable_base_id",
  "airtable_table_name",
  "airtable_field_map",
] as const;

const DEFAULTS: AirtableSettings = {
  airtable_sync_enabled: false,
  airtable_base_id: "",
  airtable_table_name: "",
  airtable_field_map: {},
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

  const byKey = new Map<string, { value: unknown; org_id: string | null }>();
  for (const r of (data ?? []) as { key: string; value: unknown; org_id: string | null }[]) {
    const prev = byKey.get(r.key);
    if (!prev || (r.org_id !== null && prev.org_id === null)) byKey.set(r.key, { value: r.value, org_id: r.org_id });
  }

  return {
    airtable_sync_enabled: (byKey.get("airtable_sync_enabled")?.value as boolean) ?? DEFAULTS.airtable_sync_enabled,
    airtable_base_id: (byKey.get("airtable_base_id")?.value as string) ?? DEFAULTS.airtable_base_id,
    airtable_table_name: (byKey.get("airtable_table_name")?.value as string) ?? DEFAULTS.airtable_table_name,
    airtable_field_map: (byKey.get("airtable_field_map")?.value as AirtableFieldMap) ?? DEFAULTS.airtable_field_map,
  };
}
