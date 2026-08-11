import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** What an organisation currently holds. Backs the four tiles at the top of
 *  Settings > Trust & data. Deliberately head counts: the tile states a volume,
 *  so there is no reason to pull rows across the wire to compute it. */
export interface OrgDataStats {
  bookings: number;
  artists: number;
  productions: number;
}

/** Tables that hold the org's own records, paired with the stat they feed. */
const COUNTED = [
  { table: "bookings", key: "bookings" },
  { table: "artists", key: "artists" },
  { table: "shows", key: "productions" },
] as const;

/** Count each holding for one org.
 *
 *  Filtered on `org_id` explicitly rather than relying on RLS to narrow the
 *  read. RLS is the guarantee; the filter is the intent. A count is the one
 *  place where silently trusting the policy would turn a scoping bug into a
 *  wrong number on a page whose whole purpose is being accurate.
 *
 *  Throws rather than defaulting to 0 on failure: "0 bookings" is a claim, and
 *  we must not make it when we do not know. */
export async function fetchOrgDataStats(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgDataStats> {
  const results = await Promise.all(
    COUNTED.map(({ table }) =>
      client.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ),
  );

  const stats = {} as OrgDataStats;
  results.forEach(({ error, count }, i) => {
    const { table, key } = COUNTED[i];
    if (error) throw error;
    if (count === null || count === undefined) {
      throw new Error(`Count unavailable for ${table}`);
    }
    stats[key] = count;
  });
  return stats;
}
