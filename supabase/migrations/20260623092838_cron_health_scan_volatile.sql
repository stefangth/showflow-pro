-- Review follow-up: cron_health_scan reads net._http_response, which pg_net's background worker mutates
-- asynchronously (outside the calling transaction). VOLATILE is the correct volatility — STABLE would
-- let the planner cache the result within a single query, hiding fresh responses if the function is ever
-- composed into a larger query or called twice in one transaction. Also alias r.created -> the
-- responded_at out-column explicitly, so the positional RETURNS TABLE mapping cannot drift silently.
CREATE OR REPLACE FUNCTION public.cron_health_scan()
RETURNS TABLE (
  job_name text, request_id bigint, dispatched_at timestamptz,
  status_code int, timed_out boolean, error_msg text, responded_at timestamptz
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (d.job_name)
      d.job_name, d.request_id, d.dispatched_at
    FROM public.cron_health_dispatch d
    ORDER BY d.job_name, d.dispatched_at DESC
  )
  SELECT l.job_name, l.request_id, l.dispatched_at,
         r.status_code, r.timed_out, r.error_msg, r.created AS responded_at
  FROM latest l
  LEFT JOIN net._http_response r ON r.id = l.request_id;
$$;
REVOKE ALL ON FUNCTION public.cron_health_scan() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_health_scan() TO service_role;
