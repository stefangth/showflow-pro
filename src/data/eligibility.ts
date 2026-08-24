import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { unionSkillIds } from "@/lib/eligibility";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

export interface RequiredSkillIds { showSkillIds: string[]; dateSkillIds: string[]; all: string[] }

/** Show-level and date-level required skills for a date, plus their effective union.
 *
 *  Effective union = (show ∪ dateAdded) \ (dateDropped ∩ show): a per-date skill
 *  drop (show_date_skill_drops) removes a show-level requirement on this date only.
 *  A drop is provenance-aware — it subtracts a skill ONLY when that skill is
 *  show-level (drops are offered only on inherited/show-level chips in the UI), so
 *  a stale drop row for a date-added skill is inert and can't silently negate a
 *  later date-add. `showSkillIds`/`dateSkillIds` stay the raw reads so callers can
 *  still render a dropped show skill as struck-through; only `all` reflects the
 *  subtraction.
 *
 *  TWIN of supabase/functions/_shared/eligibility.ts `fetchRequiredSkillIds`.
 *  The set math is identical; only the client mechanics differ. These are NOT
 *  mirror-managed, so any change to the union math must be made in both by hand. */
export async function fetchRequiredSkillIds(
  client: SupabaseClient<Database>,
  args: { showId: string; showDateId: string },
): Promise<RequiredSkillIds> {
  const { data: showRows, error: e1 } = await client
    .from("show_required_skills").select("skill_id").eq("show_id", args.showId);
  if (e1) throw e1;
  const { data: dateRows, error: e2 } = await client
    .from("show_date_required_skills").select("skill_id").eq("show_date_id", args.showDateId);
  if (e2) throw e2;
  const { data: dropRows, error: e3 } = await client
    .from("show_date_skill_drops").select("skill_id").eq("show_date_id", args.showDateId);
  if (e3) throw e3;
  const showSkillIds = (showRows ?? []).map((r) => r.skill_id);
  const dateSkillIds = (dateRows ?? []).map((r) => r.skill_id);
  const dropped = new Set((dropRows ?? []).map((r) => r.skill_id));
  const showSet = new Set(showSkillIds);
  const all = unionSkillIds(showSkillIds, dateSkillIds)
    .filter((id) => !(dropped.has(id) && showSet.has(id)));
  return { showSkillIds, dateSkillIds, all };
}

/** Artist ids holding ALL of requiredSkillIds; null when nothing is required (unrestricted).
 *  RLS scopes artist_skills to the caller's org. */
export async function fetchSkillEligibleArtistIds(
  client: SupabaseClient<Database>,
  args: { requiredSkillIds: string[] },
): Promise<Set<string> | null> {
  if (args.requiredSkillIds.length === 0) return null;
  const { data, error } = await client
    .from("artist_skills").select("artist_id, skill_id").in("skill_id", args.requiredSkillIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    counts.set(r.artist_id, (counts.get(r.artist_id) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [artistId, n] of counts) if (n === args.requiredSkillIds.length) out.add(artistId);
  return out;
}

/** The show eligibility gate's cast ids: the deduped union of show-level (show+city)
 *  and date-level cast-eligibility rows. This is the single client-side home for the
 *  gate's cast-source semantics — `fetchGateArtistIds` (tier-ladder counts) and
 *  `useEligibleArtists` (direct-book list) both resolve their cast set through it, so
 *  a change here reaches both. The edge keeps its own copy (`_shared/eligibility.ts`,
 *  a different runtime/client), so cast-source changes are made in exactly two places. */
export async function fetchGateCastIds(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string | null; showDateId: string },
): Promise<string[]> {
  const castIds: string[] = [];
  if (args.cityId) {
    const { data: showCasts, error: e1 } = await client
      .from("show_cast_eligibility")
      .select("cast_id")
      .eq("show_id", args.showId)
      .eq("city_id", args.cityId);
    if (e1) throw e1;
    for (const r of showCasts ?? []) castIds.push(r.cast_id);
  }
  const { data: dateCasts, error: e2 } = await client
    .from("show_date_cast_eligibility")
    .select("cast_id")
    .eq("show_date_id", args.showDateId);
  if (e2) throw e2;
  for (const r of dateCasts ?? []) castIds.push(r.cast_id);
  return [...new Set(castIds)];
}

/** The show eligibility gate: the gate cast ids (see fetchGateCastIds) resolved to
 *  artist ids. Null = no gate rows at all = unrestricted.
 *
 *  ENGINE-PARITY TWIN of `supabase/functions/_shared/eligibility.ts`
 *  `fetchGateArtistIds` — same null-when-empty rule and cast-members resolution.
 *  NOT mirror-managed, so any change must be made in both by hand. Consumed by
 *  `fetchTierLadderCounts` so the client-side tier-ladder counts apply the same gate
 *  the engine (open-offer-tier) applies before offering — see that file's waterfall. */
export async function fetchGateArtistIds(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string | null; showDateId: string },
): Promise<Set<string> | null> {
  const uniq = await fetchGateCastIds(client, args);
  if (uniq.length === 0) return null;

  const { data: members, error: e3 } = await client
    .from("cast_members")
    .select("artist_id")
    .in("cast_id", uniq);
  if (e3) throw e3;
  return new Set((members ?? []).map((m) => m.artist_id));
}

export interface ShowPriorityRow { id: string; cityId: string; castId: string; priority: number }

/** A show's prioritized ladder rows (priority set), all cities. */
export async function fetchShowPriorityRows(
  client: SupabaseClient<Database>,
  showId: string,
): Promise<ShowPriorityRow[]> {
  const { data, error } = await client
    .from("show_cast_eligibility")
    .select("id, city_id, cast_id, priority")
    .eq("show_id", showId)
    .not("priority", "is", null)
    .order("priority", { ascending: true });
  if (error) throw error;
  // .not("priority", "is", null) guarantees priority is set; the generated type keeps it nullable.
  return ((data ?? []) as { id: string; city_id: string; cast_id: string; priority: number }[])
    .map((r) => ({ id: r.id, cityId: r.city_id, castId: r.cast_id, priority: r.priority }));
}

/** Assign a tier: update the existing (show, city, cast) row, else insert one.
 *  A prioritized cast is by definition eligible, so inserting the row IS the gate row. */
export async function setShowCastPriority(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string; castId: string; priority: number; orgId: string },
): Promise<void> {
  const { data: existing, error: selErr } = await client
    .from("show_cast_eligibility")
    .select("id")
    .eq("show_id", args.showId).eq("city_id", args.cityId).eq("cast_id", args.castId);
  if (selErr) throw selErr;
  const row = (existing ?? [])[0];
  if (row) {
    const { error } = await client
      .from("show_cast_eligibility").update({ priority: args.priority }).eq("id", row.id);
    if (error) throw error;
  } else {
    const { error } = await client.from("show_cast_eligibility").insert({
      show_id: args.showId, city_id: args.cityId, cast_id: args.castId,
      org_id: args.orgId, priority: args.priority,
    });
    if (error) throw error;
  }
}

/** Clear a tier but keep the eligibility row (the cast stays directly bookable). */
export async function clearShowCastPriority(client: SupabaseClient<Database>, rowId: string): Promise<void> {
  const { error } = await client
    .from("show_cast_eligibility").update({ priority: null }).eq("id", rowId);
  if (error) throw error;
}

/** Show-level required skill ids (no date component). */
export async function fetchShowRequiredSkillIds(
  client: SupabaseClient<Database>,
  showId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("show_required_skills").select("skill_id").eq("show_id", showId);
  if (error) throw error;
  return (data ?? []).map((r) => r.skill_id);
}

export async function addShowDateRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string; orgId: string },
): Promise<void> {
  const { error } = await client.from("show_date_required_skills")
    .insert({ show_date_id: args.showDateId, skill_id: args.skillId, org_id: args.orgId });
  if (error) throw error;
}

export async function removeShowDateRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string },
): Promise<void> {
  const { error } = await client.from("show_date_required_skills")
    .delete().eq("show_date_id", args.showDateId).eq("skill_id", args.skillId);
  if (error) throw error;
}

/** Skill ids dropped on a date: a drop removes a show-level requirement on this
 *  date only (see show_date_skill_drops + fetchRequiredSkillIds' effective union). */
export async function fetchShowDateSkillDrops(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("show_date_skill_drops").select("skill_id").eq("show_date_id", showDateId);
  if (error) throw error;
  return (data ?? []).map((r) => r.skill_id);
}

/** Drop a show-level skill on this date. org_id is passed to satisfy the Insert
 *  type but the derive_org_id_from_show_date_id trigger overwrites it server-side. */
export async function addShowDateSkillDrop(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string; orgId: string },
): Promise<void> {
  const { error } = await client.from("show_date_skill_drops")
    .insert({ show_date_id: args.showDateId, skill_id: args.skillId, org_id: args.orgId });
  if (error) throw error;
}

/** Restore a dropped show-level skill on this date (delete the drop row). */
export async function removeShowDateSkillDrop(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string },
): Promise<void> {
  const { error } = await client.from("show_date_skill_drops")
    .delete().eq("show_date_id", args.showDateId).eq("skill_id", args.skillId);
  if (error) throw error;
}

/** The raw rows the booking-setup coverage rule needs, in one place so the pure
 *  `resolveCoverage` stays client-free. `today` is a YYYY-MM-DD cutoff (caller passes
 *  the local-tz `toDateKey(new Date())`); dates on or after it are "future". */
export async function fetchLadderCoverageInputs(
  client: SupabaseClient<Database>,
  args: { orgId: string; today: string },
): Promise<LadderCoverageInputs> {
  const dates = await client
    .from("show_dates")
    .select("show_id, city_id")
    .eq("org_id", args.orgId)
    .neq("status", "cancelled")
    .gte("date", args.today);
  if (dates.error) throw dates.error;

  const showElig = await client
    .from("show_cast_eligibility")
    .select("show_id, city_id, cast_id, priority")
    .eq("org_id", args.orgId)
    .not("priority", "is", null);
  if (showElig.error) throw showElig.error;

  const cityPri = await client
    .from("cast_city_priority")
    .select("city_id, cast_id, priority")
    .eq("org_id", args.orgId);
  if (cityPri.error) throw cityPri.error;

  // STAFFED, not merely non-empty: the member's artist must be active. `open-offer-tier`
  // filters cast members by `status = 'active'` before building its offer list, so a cast
  // whose every member has since gone inactive opens a tier to nobody. Counting it as
  // staffing the city would make the coverage rule report a shut first ask as covered.
  // Same reason `fetchSkillEligibilityGaps` joins `artists!inner(status)`.
  const members = await client
    .from("cast_members")
    .select("cast_id, artists!inner(status)")
    .eq("org_id", args.orgId)
    .eq("artists.status", "active");
  if (members.error) throw members.error;

  const dateRows = (dates.data ?? []) as { show_id: string; city_id: string | null }[];
  const showRows = (showElig.data ?? []) as { show_id: string; city_id: string; cast_id: string; priority: number }[];
  const cityRows = (cityPri.data ?? []) as { city_id: string; cast_id: string; priority: number }[];
  const nonEmptyCastIds = [...new Set((members.data ?? []).map((r) => r.cast_id as string))];
  return {
    futurePairs: dateRows.map((r) => ({ showId: r.show_id, cityId: r.city_id })),
    showPriorities: showRows.map((r) => ({ showId: r.show_id, cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
    cityPriorities: cityRows.map((r) => ({ cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
    nonEmptyCastIds,
  };
}
