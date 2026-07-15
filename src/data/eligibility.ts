import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { unionSkillIds } from "@/lib/eligibility";

// The requirement tables and show_cast_eligibility.priority are not yet in the
// generated types; casts to any are confined to this module (boundary rule).

export interface RequiredSkillIds { showSkillIds: string[]; dateSkillIds: string[]; all: string[] }

/** Show-level and date-level required skills for a date, plus their union. */
export async function fetchRequiredSkillIds(
  client: SupabaseClient<Database>,
  args: { showId: string; showDateId: string },
): Promise<RequiredSkillIds> {
  const { data: showRows, error: e1 } = await (client as any)
    .from("show_required_skills").select("skill_id").eq("show_id", args.showId);
  if (e1) throw e1;
  const { data: dateRows, error: e2 } = await (client as any)
    .from("show_date_required_skills").select("skill_id").eq("show_date_id", args.showDateId);
  if (e2) throw e2;
  const showSkillIds = ((showRows ?? []) as { skill_id: string }[]).map((r) => r.skill_id);
  const dateSkillIds = ((dateRows ?? []) as { skill_id: string }[]).map((r) => r.skill_id);
  return { showSkillIds, dateSkillIds, all: unionSkillIds(showSkillIds, dateSkillIds) };
}

/** Artist ids holding ALL of requiredSkillIds; null when nothing is required (unrestricted).
 *  RLS scopes artist_skills to the caller's org. */
export async function fetchSkillEligibleArtistIds(
  client: SupabaseClient<Database>,
  args: { requiredSkillIds: string[] },
): Promise<Set<string> | null> {
  if (args.requiredSkillIds.length === 0) return null;
  const { data, error } = await (client as any)
    .from("artist_skills").select("artist_id, skill_id").in("skill_id", args.requiredSkillIds);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { artist_id: string; skill_id: string }[]) {
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
  const { data, error } = await (client as any)
    .from("show_cast_eligibility")
    .select("id, city_id, cast_id, priority")
    .eq("show_id", showId)
    .not("priority", "is", null)
    .order("priority", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; city_id: string; cast_id: string; priority: number }[])
    .map((r) => ({ id: r.id, cityId: r.city_id, castId: r.cast_id, priority: r.priority }));
}

/** Assign a tier: update the existing (show, city, cast) row, else insert one.
 *  A prioritized cast is by definition eligible, so inserting the row IS the gate row. */
export async function setShowCastPriority(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string; castId: string; priority: number; orgId: string },
): Promise<void> {
  const { data: existing, error: selErr } = await (client as any)
    .from("show_cast_eligibility")
    .select("id")
    .eq("show_id", args.showId).eq("city_id", args.cityId).eq("cast_id", args.castId);
  if (selErr) throw selErr;
  const row = ((existing ?? []) as { id: string }[])[0];
  if (row) {
    const { error } = await (client as any)
      .from("show_cast_eligibility").update({ priority: args.priority }).eq("id", row.id);
    if (error) throw error;
  } else {
    const { error } = await (client as any).from("show_cast_eligibility").insert({
      show_id: args.showId, city_id: args.cityId, cast_id: args.castId,
      org_id: args.orgId, priority: args.priority,
    });
    if (error) throw error;
  }
}

/** Clear a tier but keep the eligibility row (the cast stays directly bookable). */
export async function clearShowCastPriority(client: SupabaseClient<Database>, rowId: string): Promise<void> {
  const { error } = await (client as any)
    .from("show_cast_eligibility").update({ priority: null }).eq("id", rowId);
  if (error) throw error;
}

export async function addShowRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showId: string; skillId: string; orgId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_required_skills")
    .insert({ show_id: args.showId, skill_id: args.skillId, org_id: args.orgId });
  if (error) throw error;
}

export async function removeShowRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showId: string; skillId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_required_skills")
    .delete().eq("show_id", args.showId).eq("skill_id", args.skillId);
  if (error) throw error;
}

export async function addShowDateRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string; orgId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_date_required_skills")
    .insert({ show_date_id: args.showDateId, skill_id: args.skillId, org_id: args.orgId });
  if (error) throw error;
}

export async function removeShowDateRequiredSkill(
  client: SupabaseClient<Database>,
  args: { showDateId: string; skillId: string },
): Promise<void> {
  const { error } = await (client as any).from("show_date_required_skills")
    .delete().eq("show_date_id", args.showDateId).eq("skill_id", args.skillId);
  if (error) throw error;
}
