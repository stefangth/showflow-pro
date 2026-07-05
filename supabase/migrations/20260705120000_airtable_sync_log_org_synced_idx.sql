-- Speeds the per-org "last poll" read that drives the airtable-poll interval gate
-- (fetchLastPollAt), and the Settings → Airtable "last sync" panel (fetchLatestSyncLog).
-- Both query airtable_sync_log by org_id + sync_type, ordered synced_at DESC, limit 1.
CREATE INDEX IF NOT EXISTS idx_airtable_sync_log_org_synced
  ON public.airtable_sync_log (org_id, sync_type, synced_at DESC);
