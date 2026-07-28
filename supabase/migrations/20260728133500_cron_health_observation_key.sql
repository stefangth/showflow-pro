-- Identity of the last observation cron-health-watcher classified for a job, so
-- consecutive_failures counts distinct failed OBSERVATIONS rather than watcher passes.
-- expire-offers dispatches hourly but the watcher scans every 15 minutes, so it re-read the same
-- dispatch row up to 4 times and incremented every pass: one timeout displayed as "3 consecutive
-- failures" in prod on 2026-07-28.
-- Format: 'req:<request_id>' when classified from a response, 'stale:<dispatched_at>' when
-- classified as stale. Nullable: pre-existing rows have no key and simply count their next
-- observation as new.
ALTER TABLE public.cron_health_state
  ADD COLUMN IF NOT EXISTS last_observation_key text;

COMMENT ON COLUMN public.cron_health_state.last_observation_key IS
  'Identity of the last classified observation (req:<request_id> or stale:<dispatched_at>). Gates consecutive_failures so re-reading one dispatch across several watcher passes counts once.';
