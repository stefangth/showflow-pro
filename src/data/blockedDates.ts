import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Artist ids in the org with a self-declared blocked date on the given calendar date.
 * Used by the direct-mode booking list so producers cannot book an artist who marked
 * themselves unavailable, mirroring open-offer-tier's server-side exclusion.
 *
 * The org filter is explicit and required. RLS does NOT narrow this to the active org:
 * `is_org_member()` short-circuits true for super-admins and is true for every org a
 * multi-org member belongs to, so without it this returns blocked ids platform-wide.
 */
export async function fetchBlockedArtistIds(
  client: SupabaseClient<Database>,
  args: { date: string; orgId: string | null },
): Promise<Set<string>> {
  if (!args.orgId) return new Set();
  const { data, error } = await client
    .from("blocked_dates")
    .select("artist_id")
    .eq("org_id", args.orgId)
    .eq("date", args.date);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.artist_id));
}

/**
 * Count of the current artist's own blocked_dates rows. Used by the artist first-run
 * readiness check (spec: "done" is satisfied by data OR ack) so an artist who has
 * genuinely blocked real dates reads as done without also needing to dismiss the rail.
 */
export async function fetchMyBlockedDatesCount(
  client: SupabaseClient<Database>,
  args: { artistId: string },
): Promise<number> {
  if (!args.artistId) return 0;
  const { count, error } = await client
    .from("blocked_dates")
    .select("id", { count: "exact", head: true })
    .eq("artist_id", args.artistId);
  if (error) throw error;
  return count ?? 0;
}
