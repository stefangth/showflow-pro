-- Wrap every cron HTTP dispatch so the returned request_id is logged -> job_name,
-- enabling per-job HTTP-status attribution by cron-health-watcher. Idempotent
-- (unschedule-if-exists + reschedule). Schedules and the cron secret are unchanged;
-- only the command body is wrapped. Adds the cron-health-watcher's own 15-min cron.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly','tier-at-risk-hourly','airtable-poll','cron-health-watcher');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('offer-digest','0 16-19 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-offer-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'offer-digest', request_id FROM r;
$$);

SELECT cron.schedule('confirmation-digest','0 17-20 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-confirmation-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'confirmation-digest', request_id FROM r;
$$);

SELECT cron.schedule('expire-offers-hourly','0 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/expire-offers',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'expire-offers-hourly', request_id FROM r;
$$);

SELECT cron.schedule('tier-at-risk-hourly','5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/tier-at-risk-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'tier-at-risk-hourly', request_id FROM r;
$$);

SELECT cron.schedule('airtable-poll','*/5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/airtable-poll',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'airtable-poll', request_id FROM r;
$$);

SELECT cron.schedule('cron-health-watcher','*/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/cron-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'cron-health-watcher', request_id FROM r;
$$);
