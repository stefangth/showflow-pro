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
