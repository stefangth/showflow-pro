import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Data-access for the Admin panel read-only activity/status surfaces.
 * Extracted from AdminPage per the src/data convention; hooks/pages become thin
 * wrappers. Org isolation is enforced by RLS on the underlying tables, so these
 * fetches carry no explicit org filter (the queries mirror the prior inline calls
 * exactly — no behavior/query-shape change).
 */

/** One booking audit-trail row with the booked artist's name joined in. */
export type AdminAuditLog = Database["public"]["Tables"]["booking_audit_log"]["Row"] & {
  booking: { artist: { name: string } | null } | null;
};

/** Most-recent booking audit-log rows (newest first), capped at `limit`. */
export async function fetchAdminAuditLogs(
  client: SupabaseClient<Database>,
  limit: number,
): Promise<AdminAuditLog[]> {
  const { data, error } = await client
    .from("booking_audit_log")
    .select("*, booking:bookings(artist:artists(name))")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AdminAuditLog[];
}

/** Most-recent Airtable sync-log rows (newest first), capped at `limit`. */
export async function fetchAdminSyncLogs(
  client: SupabaseClient<Database>,
  limit: number,
): Promise<Database["public"]["Tables"]["airtable_sync_log"]["Row"][]> {
  const { data, error } = await client
    .from("airtable_sync_log")
    .select("*")
    .order("synced_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Database["public"]["Tables"]["airtable_sync_log"]["Row"][];
}

export interface AdminStats {
  shows: number;
  artists: number;
  bookings: number;
}

/** Header stat counts (server-side head counts — no row data crosses the wire). */
export async function fetchAdminStats(
  client: SupabaseClient<Database>,
): Promise<AdminStats> {
  const [shows, artists, bookings] = await Promise.all([
    client.from("shows").select("*", { count: "exact", head: true }),
    client.from("artists").select("*", { count: "exact", head: true }),
    client.from("bookings").select("*", { count: "exact", head: true }),
  ]);
  return {
    shows: shows.count ?? 0,
    artists: artists.count ?? 0,
    bookings: bookings.count ?? 0,
  };
}
