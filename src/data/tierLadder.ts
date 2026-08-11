import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Client-side mirror of the server's tier ladder resolver
 * (`supabase/functions/_shared/eligibility.ts`: `resolveTierLadder` / `ladderCastIdsAtTier`),
 * extended to name the casts at each tier for the Offers cockpit. Show-scoped
 * prioritized `show_cast_eligibility` rows win outright for (show, city);
 * otherwise the org-wide `cast_city_priority` list for the city is the fallback.
 * A tier with multiple cast ids at the same priority yields multiple casts.
 *
 * Cast names are read directly from `casts` filtered by `.in('id', castIds)`
 * rather than via `fetchCasts` (which lists a whole org's casts): the cast ids
 * here already come from show/city-scoped queries, so per ADR-0003 ("a UUID FK
 * needs no org filter — it belongs to exactly one org") no separate org filter
 * is needed to keep this org-safe.
 */

export interface TierCastRef { id: string; name: string }
export interface TierCast { tier: number; casts: TierCastRef[] }

interface PriorityRow { cast_id: string; priority: number }

/** The tier -> cast(s) map for a (show, city), sorted by tier ascending. */
export async function fetchTierCastMap(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string | null },
): Promise<TierCast[]> {
  if (!args.cityId) return [];

  const { data: showRows, error: showErr } = await client
    .from("show_cast_eligibility")
    .select("cast_id, priority")
    .eq("show_id", args.showId)
    .eq("city_id", args.cityId)
    .not("priority", "is", null);
  if (showErr) throw showErr;
  const show = (showRows ?? []) as PriorityRow[];

  let rows: PriorityRow[];
  if (show.length > 0) {
    rows = show;
  } else {
    const { data: cityRows, error: cityErr } = await client
      .from("cast_city_priority")
      .select("cast_id, priority")
      .eq("city_id", args.cityId);
    if (cityErr) throw cityErr;
    rows = (cityRows ?? []) as PriorityRow[];
  }

  if (rows.length === 0) return [];

  const castIds = [...new Set(rows.map((r) => r.cast_id))];
  const { data: castRows, error: castErr } = await client
    .from("casts")
    .select("id, name")
    .in("id", castIds);
  if (castErr) throw castErr;
  const names = new Map(((castRows ?? []) as TierCastRef[]).map((c) => [c.id, c.name]));

  const byTier = new Map<number, TierCastRef[]>();
  for (const r of rows) {
    const arr = byTier.get(r.priority) ?? [];
    arr.push({ id: r.cast_id, name: names.get(r.cast_id) ?? "" });
    byTier.set(r.priority, arr);
  }
  return [...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tier, casts]) => ({ tier, casts }));
}
