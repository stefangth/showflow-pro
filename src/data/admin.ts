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

/** The org's most-recent booking audit-log rows (newest first), capped at `limit`.
 *  Org-filtered: RLS returns every org a super-admin or multi-org member can read. */
export async function fetchAdminAuditLogs(
  client: SupabaseClient<Database>,
  limit: number,
  orgId: string | null,
): Promise<AdminAuditLog[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("booking_audit_log")
    .select("*, booking:bookings(artist:artists(name))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AdminAuditLog[];
}

/** The org's most-recent Airtable sync-log rows (newest first), capped at `limit`. */
export async function fetchAdminSyncLogs(
  client: SupabaseClient<Database>,
  limit: number,
  orgId: string | null,
): Promise<Database["public"]["Tables"]["airtable_sync_log"]["Row"][]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("airtable_sync_log")
    .select("*")
    .eq("org_id", orgId)
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

/** Header stat counts for the org (server-side head counts — no row data crosses the
 *  wire). Org-filtered: without it these are platform-wide totals for a super-admin. */
export async function fetchAdminStats(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<AdminStats> {
  if (!orgId) return { shows: 0, artists: 0, bookings: 0 };
  const [shows, artists, bookings] = await Promise.all([
    client.from("shows").select("*", { count: "exact", head: true }).eq("org_id", orgId),
    client.from("artists").select("*", { count: "exact", head: true }).eq("org_id", orgId),
    client.from("bookings").select("*", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  return {
    shows: shows.count ?? 0,
    artists: artists.count ?? 0,
    bookings: bookings.count ?? 0,
  };
}
