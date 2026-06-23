-- Latest dispatch per job + its pg_net response. Service-role only (the watcher).
-- Encapsulates the cross-schema join the edge runtime's PostgREST client cannot do
-- (net._http_response is not API-exposed).
CREATE OR REPLACE FUNCTION public.cron_health_scan()
RETURNS TABLE (
  job_name text, request_id bigint, dispatched_at timestamptz,
  status_code int, timed_out boolean, error_msg text, responded_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH latest AS (
    SELECT DISTINCT ON (d.job_name)
      d.job_name, d.request_id, d.dispatched_at
    FROM public.cron_health_dispatch d
    ORDER BY d.job_name, d.dispatched_at DESC
  )
  SELECT l.job_name, l.request_id, l.dispatched_at,
         r.status_code, r.timed_out, r.error_msg, r.created
  FROM latest l
  LEFT JOIN net._http_response r ON r.id = l.request_id;
$$;
REVOKE ALL ON FUNCTION public.cron_health_scan() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_health_scan() TO service_role;

-- Dashboard feed: per-job state + schedule + recent failures. Super-admin gated.
CREATE OR REPLACE FUNCTION public.get_cron_health()
RETURNS TABLE (
  job_name text, schedule text, status text, last_status_code int,
  last_ok_at timestamptz, last_error text, consecutive_failures int,
  last_run_at timestamptz, recent_failures jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.job_name,
         j.schedule,
         s.status, s.last_status_code, s.last_ok_at, s.last_error, s.consecutive_failures,
         (SELECT max(start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run_at,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('status_code', g.status_code, 'error', g.error, 'observed_at', g.observed_at)
                            ORDER BY g.observed_at DESC)
           FROM (SELECT * FROM public.cron_health_log l WHERE l.job_name = s.job_name ORDER BY l.observed_at DESC LIMIT 10) g
         ), '[]'::jsonb) AS recent_failures
  FROM public.cron_health_state s
  LEFT JOIN cron.job j ON j.jobname = s.job_name
  WHERE is_super_admin(auth.uid())
  ORDER BY (s.status <> 'healthy') DESC, s.job_name;
$$;
REVOKE ALL ON FUNCTION public.get_cron_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_health() TO authenticated;
