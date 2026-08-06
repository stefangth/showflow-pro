import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Artist, Cast } from "@/types";

/**
 * Cast data access.
 *
 * Every list read here takes an explicit `orgId` and filters on it. That filter is
 * load-bearing, not decorative: `is_org_member()` short-circuits to true for
 * super-admins and returns true for every org a multi-org user belongs to, so the
 * RESTRICTIVE `org_isolation` policy does NOT narrow rows to the org currently being
 * viewed. `casts`, `cast_members` and `show_cast_eligibility` additionally have a
 * PERMISSIVE `SELECT ... USING (true)` policy, which makes `org_isolation` their only
 * row filter. Relying on RLS alone therefore renders other orgs' casts. See ADR-0003
 * ("Isolation never depends on the active-org UI filter") and src/data/cities.ts.
 *
 * Reads scoped by a UUID FK (`cast_id`, `id`) need no org filter — a UUID belongs to
 * exactly one org.
 */

type CastCityPriorityRow = Database["public"]["Tables"]["cast_city_priority"]["Row"];

export interface CastMemberWithArtist { id: string; artist_id: string; artist: Artist }

/** The org's casts, ordered by name. */
export async function fetchCasts(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Cast[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("casts").select("*").eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as Cast[];
}

/** Member count per cast id, for the org. */
export async function fetchCastMemberCounts(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Record<string, number>> {
  if (!orgId) return {};
  const { data, error } = await client
    .from("cast_members").select("cast_id").eq("org_id", orgId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { cast_id: string }[]) {
    counts[row.cast_id] = (counts[row.cast_id] ?? 0) + 1;
  }
  return counts;
}

/** Members of one cast, with the artist embedded. Scoped by cast_id (org-safe). */
export async function fetchCastMembers(
  client: SupabaseClient<Database>,
  castId: string | null,
): Promise<CastMemberWithArtist[]> {
  if (!castId) return [];
  const { data, error } = await client
    .from("cast_members").select("id, artist_id, artist:artists(*)").eq("cast_id", castId);
  if (error) throw error;
  return (data ?? []) as unknown as CastMemberWithArtist[];
}

/** City x show eligibility rows for one cast. Scoped by cast_id (org-safe). */
export async function fetchCastEligibility(
  client: SupabaseClient<Database>,
  castId: string | null,
): Promise<{ id: string; city_id: string; show_id: string }[]> {
  if (!castId) return [];
  const { data, error } = await client
    .from("show_cast_eligibility").select("id, city_id, show_id").eq("cast_id", castId);
  if (error) throw error;
  return (data ?? []) as { id: string; city_id: string; show_id: string }[];
}

/** The org's cast-per-city priority ladder. */
export async function fetchCastCityPriority(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<CastCityPriorityRow[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("cast_city_priority")
    .select("id, cast_id, city_id, priority")
    .eq("org_id", orgId)
    .order("city_id")
    .order("priority");
  if (error) throw error;
  return (data ?? []) as CastCityPriorityRow[];
}

export interface CastRef { id: string; name: string }

/** Casts per artist id, for the org — powers the cast column on the artists list. */
export async function fetchCastsByArtist(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Map<string, CastRef[]>> {
  const byArtist = new Map<string, CastRef[]>();
  if (!orgId) return byArtist;
  const { data, error } = await client
    .from("cast_members").select("artist_id, cast:casts(id, name)").eq("org_id", orgId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { artist_id: string; cast: CastRef | null }[];
  for (const row of rows) {
    if (!row.cast) continue;
    const arr = byArtist.get(row.artist_id) ?? [];
    arr.push(row.cast);
    byArtist.set(row.artist_id, arr);
  }
  return byArtist;
}

export async function createCast(
  client: SupabaseClient<Database>,
  orgId: string,
  args: { name: string; description: string | null; createdBy?: string | null },
): Promise<void> {
  const { error } = await client.from("casts").insert({
    org_id: orgId, name: args.name, description: args.description, created_by: args.createdBy ?? null,
  });
  if (error) throw error;
}

export async function updateCast(
  client: SupabaseClient<Database>,
  castId: string,
  args: { name: string; description: string | null },
): Promise<void> {
  const { error } = await client
    .from("casts")
    .update({ name: args.name, description: args.description, updated_at: new Date().toISOString() })
    .eq("id", castId);
  if (error) throw error;
}

export async function deleteCast(client: SupabaseClient<Database>, castId: string): Promise<void> {
  const { error } = await client.from("casts").delete().eq("id", castId);
  if (error) throw error;
}

export async function addCastMember(
  client: SupabaseClient<Database>,
  orgId: string,
  args: { castId: string; artistId: string },
): Promise<void> {
  const { error } = await client
    .from("cast_members").insert({ org_id: orgId, cast_id: args.castId, artist_id: args.artistId });
  if (error) throw error;
}

export async function removeCastMember(
  client: SupabaseClient<Database>,
  memberId: string,
): Promise<void> {
  const { error } = await client.from("cast_members").delete().eq("id", memberId);
  if (error) throw error;
}

export async function setCastEligibility(
  client: SupabaseClient<Database>,
  orgId: string,
  args: { castId: string; showId: string; cityId: string },
): Promise<void> {
  const { error } = await client.from("show_cast_eligibility").insert({
    org_id: orgId, cast_id: args.castId, show_id: args.showId, city_id: args.cityId,
  });
  if (error) throw error;
}

export async function clearCastEligibility(
  client: SupabaseClient<Database>,
  eligibilityId: string,
): Promise<void> {
  const { error } = await client.from("show_cast_eligibility").delete().eq("id", eligibilityId);
  if (error) throw error;
}
