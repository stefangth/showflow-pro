import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Skill = { id: string; name: string };

/** The org's ACTIVE skills, alphabetical (archived skills are hidden from every
 *  picker). Org-filtered: RLS alone would merge every org the caller can read
 *  (super-admin or multi-org member) into the skill pickers. */
export async function fetchSkills(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Skill[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("skills").select("id, name").eq("org_id", orgId).is("archived_at", null).order("name");
  if (error) throw error;
  return data ?? [];
}

/** One catalog row for the admin Skills card: the skill plus its usage counts.
 *  `requiredByCount` is the number of distinct productions (shows) requiring it;
 *  `requiredByDateCount` is the number of distinct show_dates requiring it at the
 *  date level. Both FKs (show_required_skills, show_date_required_skills) are
 *  ON DELETE RESTRICT, so both must be zero before a delete can succeed. */
export type SkillCatalogRow = {
  id: string;
  name: string;
  archivedAt: string | null;
  artistCount: number;
  requiredByCount: number;
  requiredByDateCount: number;
};

/** Row shape returned by the `skill_catalog` RPC (see migration
 *  20260811120300_skill_catalog_rpc.sql). Postgres `bigint` counts arrive over
 *  PostgREST as strings, so the mapper below Number()s them. */
interface SkillCatalogRpcRow {
  id: string;
  name: string;
  archived_at: string | null;
  artist_count: number | string;
  required_by_count: number | string;
  required_by_date_count: number | string;
}

/** Every skill in the org (including archived), alphabetical, with usage counts.
 *  Powers Settings -> Casts & Cities -> Skills. Backed by a single server-side
 *  aggregate RPC (rather than 4 full-table reads counted client-side) so the
 *  catalog stays cheap as artist_skills / required-skill rows grow. */
export async function fetchSkillCatalog(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<SkillCatalogRow[]> {
  if (!orgId) return [];
  const { data, error } = await client.rpc("skill_catalog", { p_org: orgId });
  if (error) throw error;
  return ((data ?? []) as unknown as SkillCatalogRpcRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    archivedAt: r.archived_at,
    artistCount: Number(r.artist_count),
    requiredByCount: Number(r.required_by_count),
    requiredByDateCount: Number(r.required_by_date_count),
  }));
}

/** Rename a skill (trimmed). RLS restricts this to admin/producer. */
export async function renameSkill(
  client: SupabaseClient<Database>,
  id: string,
  name: string,
): Promise<Skill> {
  const { data, error } = await client
    .from("skills").update({ name: name.trim() }).eq("id", id).select("id, name").single();
  if (error) throw error;
  return data as Skill;
}

/** Archive a skill: hides it from pickers, keeps it on the artists who hold it. */
export async function archiveSkill(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client
    .from("skills").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Restore an archived skill. */
export async function restoreSkill(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client.from("skills").update({ archived_at: null }).eq("id", id);
  if (error) throw error;
}

/** Delete a skill. The DB blocks this when a production/date still requires it
 *  (show/show_date required-skill FKs are ON DELETE RESTRICT); artist-only skills
 *  delete and cascade off those artists. RLS restricts delete to admin. */
export async function deleteSkill(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client.from("skills").delete().eq("id", id);
  if (error) throw error;
}

/** Per skill, the count of upcoming (>= today), non-cancelled dates whose required
 *  -skill union (show-level + date-level) includes it. Powers the "N upcoming dates"
 *  metadata on the artist-profile skill rows. */
export async function fetchUpcomingDateCountsBySkill(
  client: SupabaseClient<Database>,
  orgId: string | null,
  todayIso: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!orgId) return out;

  const { data: dates, error: dErr } = await client
    .from("show_dates").select("id, show_id").eq("org_id", orgId)
    .gte("date", todayIso).neq("status", "cancelled");
  if (dErr) throw dErr;
  const dateRows = (dates ?? []) as { id: string; show_id: string }[];
  if (dateRows.length === 0) return out;

  const [showReq, dateReq] = await Promise.all([
    client.from("show_required_skills").select("show_id, skill_id").eq("org_id", orgId),
    client.from("show_date_required_skills").select("show_date_id, skill_id").eq("org_id", orgId),
  ]);
  if (showReq.error) throw showReq.error;
  if (dateReq.error) throw dateReq.error;

  const byShow = new Map<string, Set<string>>();
  for (const r of (showReq.data ?? []) as { show_id: string; skill_id: string }[]) {
    const s = byShow.get(r.show_id) ?? new Set<string>();
    s.add(r.skill_id);
    byShow.set(r.show_id, s);
  }
  const byDate = new Map<string, Set<string>>();
  for (const r of (dateReq.data ?? []) as { show_date_id: string; skill_id: string }[]) {
    const s = byDate.get(r.show_date_id) ?? new Set<string>();
    s.add(r.skill_id);
    byDate.set(r.show_date_id, s);
  }

  for (const d of dateRows) {
    const union = new Set<string>([...(byShow.get(d.show_id) ?? []), ...(byDate.get(d.id) ?? [])]);
    for (const sid of union) out.set(sid, (out.get(sid) ?? 0) + 1);
  }
  return out;
}

/** Skills per artist id across the org — powers the skills column on the artists list. */
export async function fetchSkillsByArtist(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Map<string, Skill[]>> {
  const byArtist = new Map<string, Skill[]>();
  if (!orgId) return byArtist;
  const { data, error } = await client
    .from("artist_skills").select("artist_id, skill:skills(id, name)").eq("org_id", orgId);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as { artist_id: string; skill: Skill | null }[]) {
    if (!row.skill) continue;
    const arr = byArtist.get(row.artist_id) ?? [];
    arr.push(row.skill);
    byArtist.set(row.artist_id, arr);
  }
  return byArtist;
}

/** Skills attached to an artist, flattened from the join and sorted by name. */
export async function fetchArtistSkills(
  client: SupabaseClient<Database>,
  artistId: string,
): Promise<Skill[]> {
  const { data, error } = await client
    .from("artist_skills")
    .select("skill:skills(id, name)")
    .eq("artist_id", artistId);
  if (error) throw error;
  return ((data ?? []) as unknown as { skill: Skill | null }[])
    .map((r) => r.skill)
    .filter((s): s is Skill => Boolean(s))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SkillGap { skillId: string; name: string }

/** Skills that some part requires but no ACTIVE artist holds. An empty result means the
 *  skill model is coherent, which includes an org that requires no skills at all. Reads
 *  the trigger-maintained `show_required_skills` cache; never write that table. */
export async function fetchSkillEligibilityGaps(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<SkillGap[]> {
  if (!orgId) return [];
  const required = await client.from("show_required_skills").select("skill_id").eq("org_id", orgId);
  if (required.error) throw required.error;
  const requiredIds = [...new Set((required.data ?? []).map((r) => r.skill_id as string))];
  if (requiredIds.length === 0) return [];

  const held = await client
    .from("artist_skills")
    .select("skill_id, artists!inner(status)")
    .eq("org_id", orgId)
    .eq("artists.status", "active");
  if (held.error) throw held.error;
  const heldIds = new Set((held.data ?? []).map((r) => (r as { skill_id: string }).skill_id));

  const missing = requiredIds.filter((id) => !heldIds.has(id));
  if (missing.length === 0) return [];

  const named = await client.from("skills").select("id, name").in("id", missing);
  if (named.error) throw named.error;
  return (named.data ?? []).map((s) => ({ skillId: s.id as string, name: s.name as string }));
}

/** Create a skill from a (trimmed) name, scoped to the given org. */
export async function createSkill(
  client: SupabaseClient<Database>,
  name: string,
  orgId: string,
): Promise<Skill> {
  const trimmed = name.trim();
  const { data, error } = await client
    .from("skills")
    .insert({ name: trimmed, org_id: orgId })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as Skill;
}
