import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface CityLink { id: string; name: string; airtable_city_key: string | null }

/** Org's cities with their Airtable link key, for the catalog-linking UI. */
export async function fetchCitiesForLinking(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<CityLink[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("cities").select("id, name, airtable_city_key").eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as CityLink[];
}

/** Link (or, with null, unlink) a city to an Airtable city-option key. */
export async function linkCityAirtableKey(
  client: SupabaseClient<Database>,
  cityId: string,
  key: string | null,
): Promise<void> {
  const { error } = await client.from("cities").update({ airtable_city_key: key }).eq("id", cityId);
  if (error) throw error;
}

/** Bulk-create cities from Airtable City options. Each row: { name, key }. org_id set; idempotency
 *  (skipping already-linked keys) is the caller's job — pass only unlinked options. */
export async function importCitiesFromOptions(
  client: SupabaseClient<Database>,
  orgId: string,
  rows: Array<{ name: string; key: string }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await client
    .from("cities")
    .insert(rows.map((r) => ({ org_id: orgId, name: r.name, airtable_city_key: r.key })));
  if (error) throw error;
}

/** Merge duplicate cities: repoint every city_id FK from the losers to the survivor, then delete
 *  the losers. Server-enforced admin-only (merge_cities RPC). */
export async function mergeCities(
  client: SupabaseClient<Database>,
  survivorId: string,
  loserIds: string[],
): Promise<void> {
  const { error } = await client.rpc("merge_cities", { p_survivor: survivorId, p_losers: loserIds });
  if (error) throw error;
}
