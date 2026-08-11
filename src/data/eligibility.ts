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

  const dateRows = (dates.data ?? []) as { show_id: string; city_id: string | null }[];
  const showRows = (showElig.data ?? []) as { show_id: string; city_id: string; cast_id: string; priority: number }[];
  const cityRows = (cityPri.data ?? []) as { city_id: string; cast_id: string; priority: number }[];
  return {
    futurePairs: dateRows.map((r) => ({ showId: r.show_id, cityId: r.city_id })),
    showPriorities: showRows.map((r) => ({ showId: r.show_id, cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
    cityPriorities: cityRows.map((r) => ({ cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
  };
}
