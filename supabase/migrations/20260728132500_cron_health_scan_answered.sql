-- Split "which dispatch is newest" from "which dispatch actually answered".
--
-- cron_health_scan previously returned only the newest dispatch per job and LEFT JOINed its
-- response. cron-health-watcher therefore skipped any job whose newest dispatch was still in
-- flight -- which for the watcher itself is ALWAYS true, because its own dispatch is in flight for
-- the whole time it runs. It could still mark itself failing (pg_net abandons its request at the
-- timeout and writes timed_out, which the still-running watcher then reads), but it could never
-- mark itself healthy again. In prod its last_ok_at was frozen at 2026-06-24 while the edge logs
-- showed it returning 200 every 15 minutes.
--
-- Now: `dispatched_at` is still the newest dispatch of any kind (the staleness source, unchanged
-- meaning), while the outcome columns come from the newest dispatch that has a response row, and
-- `answered_at` says which dispatch that was. All previously returned column names and meanings are
-- preserved, so an older deployed watcher keeps working against this function.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding a column changes the return type, which
-- CREATE OR REPLACE cannot do ("cannot change return type of existing function").
DROP FUNCTION IF EXISTS public.cron_health_scan();

CREATE FUNCTION public.cron_health_scan()
RETURNS TABLE (
  job_name text, request_id bigint, dispatched_at timestamptz, answered_at timestamptz,
  status_code int, timed_out boolean, error_msg text, responded_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (d.job_name) d.job_name, d.dispatched_at
    FROM public.cron_health_dispatch d
    ORDER BY d.job_name, d.dispatched_at DESC
  ),
  answered AS (
    SELECT DISTINCT ON (d.job_name)
      d.job_name, d.request_id, d.dispatched_at,
      r.status_code, r.timed_out, r.error_msg, r.created AS responded_at
    FROM public.cron_health_dispatch d
    JOIN net._http_response r ON r.id = d.request_id
    ORDER BY d.job_name, d.dispatched_at DESC
  )
  SELECT l.job_name, a.request_id, l.dispatched_at, a.dispatched_at,
         a.status_code, a.timed_out, a.error_msg, a.responded_at
  FROM latest l
  LEFT JOIN answered a ON a.job_name = l.job_name;
$$;
REVOKE ALL ON FUNCTION public.cron_health_scan() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_health_scan() TO service_role;
