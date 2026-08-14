/**
 * Pure data-shaping + status logic for the Coverage sub-tab (Settings → Casts & coverage).
 * No Supabase client here — callers fetch the raw rows (cities, casts, cast_city_priority /
 * show_cast_eligibility) and hand them to these builders, which stay independently testable.
 */

export const COVERAGE_TIER_COUNT = 3;

export interface CoverageCastRef {
  id: string;
  name: string;
  memberCount: number;
}

export interface CoverageCityRow {
  cityId: string;
  cityName: string;
  showsCount: number;
  /** index 0 = Tier 1, index 1 = Tier 2, index 2 = Tier 3; null = empty slot. */
  tiers: (CoverageCastRef | null)[];
}

export interface CoverageCityRowWithSource extends CoverageCityRow {
  /** Whether this city's tiers came from a per-show override or the org default. */
  source: "override" | "default";
}

export type CoverageStatus = "blocked" | "single" | "ready";

export interface CoverageStatusResult {
  status: CoverageStatus;
  filledCount: number;
}

/** A city's coverage status from its tier slots. No Tier 1 blocks the offer engine
 *  outright; exactly one filled tier (even just Tier 1) has no fallback cast if that
 *  cast can't fill; two or more filled tiers are considered ready. */
export function coverageStatus(tiers: (CoverageCastRef | null)[]): CoverageStatusResult {
  const filledCount = tiers.filter((t) => t != null).length;
  if (tiers[0] == null) return { status: "blocked", filledCount };
  if (filledCount === 1) return { status: "single", filledCount };
  return { status: "ready", filledCount };
}

export interface CoverageKpis {
  cities: number;
  offersBlocked: number;
  singleTier: number;
  showOverrides: number;
}

/** Org-level coverage KPIs. `showOverrideCount` is computed separately (it comes from
 *  show_cast_eligibility, not from the city rows) and passed in. */
export function coverageKpis(rows: CoverageCityRow[], showOverrideCount: number): CoverageKpis {
  let offersBlocked = 0;
  let singleTier = 0;
  for (const row of rows) {
    const { status } = coverageStatus(row.tiers);
    if (status === "blocked") offersBlocked++;
    else if (status === "single") singleTier++;
  }
  return { cities: rows.length, offersBlocked, singleTier, showOverrides: showOverrideCount };
}

interface PriorityRow {
  cityId: string;
  castId: string;
  priority: number;
}

/** Place priority rows into the fixed tier slots for one city, dropping anything outside
 *  1..COVERAGE_TIER_COUNT and anything referencing a cast we don't have a name for. */
function tiersFor(
  cityId: string,
  priorities: PriorityRow[],
  castsById: Map<string, { id: string; name: string }>,
  castCounts: Record<string, number>,
): (CoverageCastRef | null)[] {
  const tiers: (CoverageCastRef | null)[] = Array.from({ length: COVERAGE_TIER_COUNT }, () => null);
  for (const p of priorities) {
    if (p.cityId !== cityId) continue;
    const idx = p.priority - 1;
    if (idx < 0 || idx >= tiers.length) continue;
    const cast = castsById.get(p.castId);
    if (!cast) continue;
    tiers[idx] = { id: cast.id, name: cast.name, memberCount: castCounts[cast.id] ?? 0 };
  }
  return tiers;
}

/** Build the org-default coverage matrix: one row per city, tiers from cast_city_priority. */
export function buildCoverageRows(args: {
  cities: { id: string; name: string }[];
  castsById: Map<string, { id: string; name: string }>;
  castCounts: Record<string, number>;
  priorities: PriorityRow[];
  showsCountByCity: Map<string, number>;
}): CoverageCityRow[] {
  return args.cities.map((city) => ({
    cityId: city.id,
    cityName: city.name,
    showsCount: args.showsCountByCity.get(city.id) ?? 0,
    tiers: tiersFor(city.id, args.priorities, args.castsById, args.castCounts),
  }));
}

/** Build the per-show coverage matrix: a city's tiers come from the show's OWN prioritized
 *  rows for that city when any exist (source: "override"), else fall back to the org default
 *  for that city (source: "default"). Mirrors `fetchTierCastMap`'s all-or-nothing per-city
 *  override semantics: a show either overrides a city's whole ladder or inherits it whole. */
export function buildPerShowCoverageRows(args: {
  cities: { id: string; name: string }[];
  castsById: Map<string, { id: string; name: string }>;
  castCounts: Record<string, number>;
  orgPriorities: PriorityRow[];
  showPriorities: PriorityRow[];
  showsCountByCity: Map<string, number>;
}): CoverageCityRowWithSource[] {
  return args.cities.map((city) => {
    const overrideRows = args.showPriorities.filter((p) => p.cityId === city.id);
    const source: "override" | "default" = overrideRows.length > 0 ? "override" : "default";
    const tiers = tiersFor(
      city.id,
      source === "override" ? overrideRows : args.orgPriorities,
      args.castsById,
      args.castCounts,
    );
    return {
      cityId: city.id,
      cityName: city.name,
      showsCount: args.showsCountByCity.get(city.id) ?? 0,
      tiers,
      source,
    };
  });
}

/** Distinct show ids per city, from (showId, cityId) pairs — cityId may be null (unassigned
 *  dates), which is dropped since it can't attribute to any city row. */
export function showsCountByCity(pairs: { showId: string; cityId: string | null }[]): Map<string, number> {
  const byCity = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.cityId) continue;
    const set = byCity.get(p.cityId) ?? new Set<string>();
    set.add(p.showId);
    byCity.set(p.cityId, set);
  }
  const out = new Map<string, number>();
  for (const [cityId, shows] of byCity) out.set(cityId, shows.size);
  return out;
}

/** Distinct cities a cast appears in, from the org-default priority rows. */
export function castCityUsage(priorities: { cityId: string; castId: string }[]): Map<string, number> {
  const byCast = new Map<string, Set<string>>();
  for (const p of priorities) {
    const set = byCast.get(p.castId) ?? new Set<string>();
    set.add(p.cityId);
    byCast.set(p.castId, set);
  }
  const out = new Map<string, number>();
  for (const [castId, cities] of byCast) out.set(castId, cities.size);
  return out;
}

/** Count of shows that have at least one prioritized (overridden) city. */
export function distinctShowOverrideCount(showPriorities: { showId: string }[]): number {
  return new Set(showPriorities.map((r) => r.showId)).size;
}

/** Distinct cities a given show has overridden, from the org-wide show-priorities list. */
export function overriddenCityCountForShow(showId: string, showPriorities: { showId: string; cityId: string }[]): number {
  return new Set(showPriorities.filter((r) => r.showId === showId).map((r) => r.cityId)).size;
}

export interface CityReference {
  /** Future, non-cancelled show_dates in this city. */
  showsCount: number;
  /** cast_city_priority rows (the org-default tier ladder) for this city. */
  orgTierCount: number;
  /** show_cast_eligibility priority rows (per-show overrides, any show) for this city. */
  overrideCount: number;
}

/** Whether ANYTHING points at this city. `cast_city_priority.city_id` and
 *  `show_cast_eligibility.city_id` are both ON DELETE CASCADE, so a city with a
 *  configured tier ladder or a per-show override — even with zero upcoming shows —
 *  still silently loses that data if deleted. A city may only be removed once nothing
 *  references it: no upcoming show, no org-default tier, and no per-show override. */
export function isCityReferenced(ref: CityReference): boolean {
  return ref.showsCount > 0 || ref.orgTierCount > 0 || ref.overrideCount > 0;
}

/** Per-city reference counts, for the Cities card's usage text and the delete guard. */
export function buildCityReferences(args: {
  cities: { id: string }[];
  showsCountByCity: Map<string, number>;
  orgPriorities: { cityId: string }[];
  showPriorities: { cityId: string }[];
}): Map<string, CityReference> {
  const out = new Map<string, CityReference>();
  for (const city of args.cities) {
    out.set(city.id, {
      showsCount: args.showsCountByCity.get(city.id) ?? 0,
      orgTierCount: args.orgPriorities.filter((p) => p.cityId === city.id).length,
      overrideCount: args.showPriorities.filter((p) => p.cityId === city.id).length,
    });
  }
  return out;
}
