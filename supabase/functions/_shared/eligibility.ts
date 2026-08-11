// Shared eligibility resolution for the booking engine (phase 4).
// Single server-side home for: the effective tier ladder (show override, else
// org city list), the show eligibility gate, required skills, and the skills
// filter. Consumed by open-offer-tier and expire-offers.
import type { Deps } from "./deps.ts";

type Admin = Deps["admin"];

export interface TierLadder {
  source: "show" | "org";
  tiers: { tier: number; castId: string }[];
}

/** Effective ladder for (show, city): show-scoped prioritized rows win outright;
 *  otherwise the org-wide cast_city_priority list for the city.
 *  Queries here (and in the gate below) deliberately filter by show_id/city_id
 *  without an explicit org_id: shows and cities are tenant-owned rows whose ids
 *  never cross orgs, so FK scoping already pins the org. Not an oversight. */
export async function resolveTierLadder(admin: Admin, showId: string, cityId: string): Promise<TierLadder> {
  const { data: showRows } = await admin
    .from("show_cast_eligibility")
    .select("cast_id, priority")
    .eq("show_id", showId)
    .eq("city_id", cityId)
    .not("priority", "is", null);
  const show = (showRows ?? []) as Array<{ cast_id: string; priority: number }>;
  if (show.length > 0) {
    return {
      source: "show",
      tiers: show.map((r) => ({ tier: r.priority, castId: r.cast_id })).sort((a, b) => a.tier - b.tier),
    };
  }
  const { data: orgRows } = await admin
    .from("cast_city_priority")
    .select("cast_id, priority")
    .eq("city_id", cityId);
  const org = (orgRows ?? []) as Array<{ cast_id: string; priority: number }>;
  return {
    source: "org",
    tiers: org.map((r) => ({ tier: r.priority, castId: r.cast_id })).sort((a, b) => a.tier - b.tier),
  };
}

export function ladderCastIdsAtTier(ladder: TierLadder, tier: number): string[] {
  return ladder.tiers.filter((t) => t.tier === tier).map((t) => t.castId);
}

/** Smallest ladder tier strictly greater than currentTier, or null when exhausted. */
export function nextTierAfter(ladder: TierLadder, currentTier: number): number | null {
  const higher = ladder.tiers.map((t) => t.tier).filter((t) => t > currentTier);
  return higher.length > 0 ? Math.min(...higher) : null;
}

/** The show eligibility gate: union of show-level (show+city) and date-level cast rows,
 *  resolved to artist ids. Null = no gate rows at all = unrestricted
 *  (mirrors useEligibleArtists semantics on the frontend). */
export async function fetchGateArtistIds(
  admin: Admin,
  args: { showId: string; cityId: string | null; showDateId: string },
): Promise<Set<string> | null> {
  const castIds: string[] = [];
  if (args.cityId) {
    const { data: showCasts } = await admin
      .from("show_cast_eligibility")
      .select("cast_id")
      .eq("show_id", args.showId)
      .eq("city_id", args.cityId);
    for (const r of (showCasts ?? []) as Array<{ cast_id: string }>) castIds.push(r.cast_id);
  }
  const { data: dateCasts } = await admin
    .from("show_date_cast_eligibility")
    .select("cast_id")
    .eq("show_date_id", args.showDateId);
  for (const r of (dateCasts ?? []) as Array<{ cast_id: string }>) castIds.push(r.cast_id);

  const uniq = [...new Set(castIds)];
  if (uniq.length === 0) return null;

  const { data: members } = await admin
    .from("cast_members")
    .select("artist_id")
    .in("cast_id", uniq);
  return new Set(((members ?? []) as Array<{ artist_id: string }>).map((m) => m.artist_id));
}

/** Effective required skills for a date, deduped, stable order.
 *
 *  Effective union = (show ∪ dateAdded) \ dateDropped: a per-date skill drop
 *  (show_date_skill_drops) removes a show-level requirement on this date only.
 *  Dropping a skill that isn't required is inert.
 *
 *  TWIN of src/data/eligibility.ts `fetchRequiredSkillIds`. The set math is
 *  identical; only the client mechanics differ. These are NOT mirror-managed, so
 *  any change to the union math must be made in both by hand. */
export async function fetchRequiredSkillIds(
  admin: Admin,
  args: { showId: string; showDateId: string },
): Promise<string[]> {
  const { data: showSkills } = await admin
    .from("show_required_skills")
    .select("skill_id")
    .eq("show_id", args.showId);
  const { data: dateSkills } = await admin
    .from("show_date_required_skills")
    .select("skill_id")
    .eq("show_date_id", args.showDateId);
  const { data: dropSkills } = await admin
    .from("show_date_skill_drops")
    .select("skill_id")
    .eq("show_date_id", args.showDateId);
  const dropped = new Set(
    ((dropSkills ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id),
  );
  const all = [
    ...((showSkills ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id),
    ...((dateSkills ?? []) as Array<{ skill_id: string }>).map((r) => r.skill_id),
  ];
  return [...new Set(all)].filter((id) => !dropped.has(id));
}

/** Artists (of artistIds) holding ALL of requiredSkillIds. Empty requirements pass everyone. */
export async function filterArtistIdsBySkills(
  admin: Admin,
  artistIds: string[],
  requiredSkillIds: string[],
): Promise<string[]> {
  if (requiredSkillIds.length === 0 || artistIds.length === 0) return artistIds;
  const { data: rows } = await admin
    .from("artist_skills")
    .select("artist_id, skill_id")
    .in("artist_id", artistIds)
    .in("skill_id", requiredSkillIds);
  const counts = new Map<string, number>();
  for (const r of (rows ?? []) as Array<{ artist_id: string; skill_id: string }>) {
    counts.set(r.artist_id, (counts.get(r.artist_id) ?? 0) + 1);
  }
  // (artist_id, skill_id) is the junction PK, so counting rows equals counting distinct skills.
  return artistIds.filter((id) => (counts.get(id) ?? 0) === requiredSkillIds.length);
}
