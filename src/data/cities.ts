import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type CityRow = Database["public"]["Tables"]["cities"]["Row"];

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

/** Org's cities as full rows, for admin/booking surfaces. The explicit org_id filter is
 *  required: god-mode RLS returns rows across ALL of a super-admin's orgs, so relying on
 *  RLS alone could render another org's cities. */
export async function fetchCities(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<CityRow[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("cities").select("*").eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as CityRow[];
}

/** Thrown by `createCity` for a blank name. A sentinel, not prose: the data layer has no
 *  `t()`, so hardcoded English here would be one `toErrorMessage` away from a toast.
 *  Callers match on it and own the copy. */
export const CITY_NAME_REQUIRED = "CITY_NAME_REQUIRED";

/** Add a city to the org's shared catalog. Cities are org-wide, not per production: the
 *  production dialog is only a convenient second place to call this from. The per-org
 *  unique index cities_org_name_uniq raises 23505 on a duplicate; callers surface it. */
export async function createCity(
  client: SupabaseClient<Database>,
  args: { name: string; orgId: string },
): Promise<{ id: string; name: string }> {
  const name = args.name.trim();
  if (!name) throw new Error(CITY_NAME_REQUIRED);
  const { data, error } = await client
    .from("cities")
    .insert({ name, org_id: args.orgId })
    .select("id, name")
    .single();
  if (error) throw error;
  return { id: data.id as string, name: data.name as string };
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

/** Rename a city. The per-org unique index cities_org_name_uniq raises 23505 on a name
 *  collision within the org; callers surface that as a friendly duplicate-name message. */
export async function updateCity(
  client: SupabaseClient<Database>,
  id: string,
  name: string,
): Promise<CityRow> {
  const { data, error } = await client
    .from("cities").update({ name: name.trim() }).eq("id", id).select().single();
  if (error) throw error;
  return data as CityRow;
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
