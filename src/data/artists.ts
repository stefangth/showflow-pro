import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Artist } from "@/types";

/** Fetch the artists row linked to a given auth user id (or null). */
export async function fetchMyArtist(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Artist | null> {
  const { data, error } = await client
    .from("artists")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Artist | null) ?? null;
}
