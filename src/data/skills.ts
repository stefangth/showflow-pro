import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Skill = { id: string; name: string };

/** All skills, alphabetical. */
export async function fetchSkills(client: SupabaseClient<Database>): Promise<Skill[]> {
  const { data, error } = await client.from("skills").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
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

/** Create a skill from a (trimmed) name. */
export async function createSkill(
  client: SupabaseClient<Database>,
  name: string,
): Promise<Skill> {
  const trimmed = name.trim();
  const { data, error } = await client
    .from("skills")
    .insert({ name: trimmed })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as Skill;
}
