-- Bound airtable_sync_record_log growth.
--
-- The airtable-poll function appends one row per record outcome on every poll.
-- Records that stay held_unresolved (an unlinked program/city) or get re-written as
-- `updated` recur on every poll, so the table grows without bound: in production it
-- reached >1GB (1002MB of it the raw_fields jsonb on repeated held rows). The edge
-- function no longer snapshots raw_fields for those recurring actions, but the row
-- count still needs a ceiling. Prune rows older than 30 days once a day.
--
-- The UI ("Last sync report") only ever reads the latest sync run's rows, so a 30-day
-- window is comfortably more history than any consumer uses.
--
-- Not applied by the Sep 1 production deploy (the Supabase integration failed with a
-- read-only-transaction error). Re-touched on 2026-09-11 to trigger the deploy again.

-- Support the nightly prune's range scan. The table's only created_at-bearing index
-- is the composite (org_id, created_at), which the planner can't use for a filter that
-- doesn't also constrain org_id, so a bare `created_at < ...` DELETE would seq-scan the
-- whole table every night. Mirror email_send_log_created_idx (20260710231816) with a
-- standalone created_at index.
CREATE INDEX IF NOT EXISTS idx_airtable_sync_record_log_created
  ON public.airtable_sync_record_log (created_at);

-- Idempotent: drop any prior instance of this job first (mirrors 20260514290000).
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'prune-airtable-sync-record-log';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Daily at 03:17 UTC (off-peak, no overlap with the digest/expiry jobs).
SELECT cron.schedule(
  'prune-airtable-sync-record-log',
  '17 3 * * *',
  $$ DELETE FROM public.airtable_sync_record_log WHERE created_at < now() - interval '30 days' $$
);
