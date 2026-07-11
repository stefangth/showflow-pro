-- Schedule email-health-watcher every 15 min, mirroring cron-health-watcher's dispatch
-- pattern exactly (net.http_post + X-Cron-Secret + 30s timeout + cron_health_dispatch
-- capture row). Idempotent (unschedule-if-exists + reschedule), matching
-- 20260624101342_cron_dispatch_timeout.sql's idiom.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'email-health-watcher';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('email-health-watcher','*/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/email-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=30000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'email-health-watcher', request_id FROM r;
$$);
