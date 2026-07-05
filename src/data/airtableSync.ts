import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface SyncLogSummary {
  id: string;
  status: string;
  imported_count: number | null;
  new_count: number | null;
  updated_count: number | null;
  held_count: number | null;
  error_details: string | null;
  synced_at: string;
}

export interface UnresolvedRecord {
  id: string;
  airtable_record_id: string | null;
  reason: string | null;
  created_at: string;
  /** `held_unresolved` = option not linked (link it and it imports next run);
   *  `error` = a DB write failed for this record (investigate). */
  action: "held_unresolved" | "error";
}

/** The org's most recent airtable_sync_log row, or null if it has never synced. */
export async function fetchLatestSyncLog(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<SyncLogSummary | null> {
  if (!orgId) return null;
  const { data, error } = await client
    .from("airtable_sync_log")
    .select("id, status, imported_count, new_count, updated_count, held_count, error_details, synced_at")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data ?? null) as SyncLogSummary | null;
}

/** Unresolved records for a given sync-log run, newest first: both `held_unresolved`
 *  (option not linked) and `error` (DB write failed). The `action` field lets the UI
 *  split them — imported/updated rows are excluded. */
export async function fetchUnresolvedRecords(
  client: SupabaseClient<Database>,
  syncLogId: string | null,
): Promise<UnresolvedRecord[]> {
  if (!syncLogId) return [];
  const { data, error } = await client
    .from("airtable_sync_record_log")
    .select("id, airtable_record_id, reason, created_at, action")
    .eq("sync_log_id", syncLogId).in("action", ["held_unresolved", "error"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UnresolvedRecord[];
}

export interface SyncNowResult {
  ok: boolean;
  orgs_synced: number;
  result: { processed: number; new_dates: number; updated: number; held: number; tiers_opened: number } | null;
}

/**
 * Trigger an immediate Airtable poll for one org (the "Sync now" button). Calls the
 * airtable-poll function with a JWT (attached by supabase-js) + org_id, hitting its
 * scoped org-admin branch — a single-org sync that bypasses the interval gate.
 */
export async function triggerAirtableSyncNow(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<SyncNowResult> {
  const { data, error } = await client.functions.invoke("airtable-poll", { body: { org_id: orgId } });
  if (error) throw error;
  return data as SyncNowResult;
}
