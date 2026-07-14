import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Artist ids with a self-declared blocked date on the given calendar date.
 * RLS scopes reads: artists see their own rows, admins/producers see their
 * org's rows (plus the restrictive org-isolation policy). Used by the
 * direct-mode booking list so producers cannot book an artist who marked
 * themselves unavailable, mirroring open-offer-tier's server-side exclusion.
 */
export async function fetchBlockedArtistIds(
  client: SupabaseClient<Database>,
  args: { date: string },
): Promise<Set<string>> {
  const { data, error } = await client
    .from("blocked_dates")
    .select("artist_id")
    .eq("date", args.date);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.artist_id));
}
