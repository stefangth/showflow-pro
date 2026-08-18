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
