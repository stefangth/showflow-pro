import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Skill = { id: string; name: string };

/** The org's skills, alphabetical. Org-filtered: RLS alone would merge every org the
 *  caller can read (super-admin or multi-org member) into the skill pickers. */
export async function fetchSkills(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Skill[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("skills").select("id, name").eq("org_id", orgId).order("name");
  if (error) throw error;
  return data ?? [];
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
