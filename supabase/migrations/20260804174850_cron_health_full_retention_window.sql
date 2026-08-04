-- get_cron_health returned only the 10 most recent failures per job, which is narrower than
-- the 30 days cron-health-watcher actually retains in cron_health_log. The System Health
-- console now draws a 7-day incident timeline from those rows, and a job that flapped more
-- than ten times would have had days silently render clean. Widen the cap to the retention
-- window's worth of incidents; everything else about the function is unchanged.
--
-- 100 is a guard, not a window: the watcher logs one row per failure INCIDENT (on the
-- transition into failing), not per failed run, so a job would have to break and recover
-- 100 times in 30 days to reach it.
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
           FROM (SELECT * FROM public.cron_health_log l WHERE l.job_name = s.job_name ORDER BY l.observed_at DESC LIMIT 100) g
         ), '[]'::jsonb) AS recent_failures
  FROM public.cron_health_state s
  LEFT JOIN cron.job j ON j.jobname = s.job_name
  WHERE is_super_admin(auth.uid())
  ORDER BY (s.status <> 'healthy') DESC, s.job_name;
$$;
REVOKE ALL ON FUNCTION public.get_cron_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_health() TO authenticated;
