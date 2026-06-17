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

export interface HeldRecord {
  id: string;
  airtable_record_id: string | null;
  reason: string | null;
  created_at: string;
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

/** Held (unresolved) records for a given sync-log run, newest first. */
export async function fetchHeldRecords(
  client: SupabaseClient<Database>,
  syncLogId: string | null,
): Promise<HeldRecord[]> {
  if (!syncLogId) return [];
  const { data, error } = await client
    .from("airtable_sync_record_log")
    .select("id, airtable_record_id, reason, created_at")
    .eq("sync_log_id", syncLogId).eq("action", "held_unresolved")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as HeldRecord[];
}
