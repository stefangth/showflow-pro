-- Restore VOLATILE on cron_health_scan.
--
-- 20260623092838_cron_health_scan_volatile.sql deliberately moved this function from STABLE to
-- VOLATILE: it reads net._http_response, which pg_net's background worker mutates asynchronously
-- OUTSIDE the calling transaction. STABLE promises the planner the result cannot change within a
-- statement, which lets it cache the rows and hide responses that landed mid-transaction -- exactly
-- the fresh responses this watcher exists to observe.
--
-- 20260728144736_cron_health_scan_answered.sql had to DROP + CREATE (adding answered_at changes the
-- return type, which CREATE OR REPLACE cannot do) and was written from the ORIGINAL 20260623040837
-- body as its template, which predates the volatility fix -- so it silently reintroduced STABLE.
-- Confirmed live on the production project: provolatile = 's'.
--
-- CREATE OR REPLACE is sufficient here because the return type is unchanged; the body below is
-- byte-identical to 20260728144736 apart from the volatility keyword. Grants survive REPLACE, but
-- they are re-applied to keep this file a complete statement of the function's exposure.
CREATE OR REPLACE FUNCTION public.cron_health_scan()
RETURNS TABLE (
  job_name text, request_id bigint, dispatched_at timestamptz, answered_at timestamptz,
  status_code int, timed_out boolean, error_msg text, responded_at timestamptz
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
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
