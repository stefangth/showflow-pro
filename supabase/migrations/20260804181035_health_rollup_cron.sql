-- Dispatch health-rollup every 15 minutes. Minute 7 is unused by the existing jobs
-- (expire-offers :00, airtable-poll :02, offer-digest :03, confirmation-digest :04,
-- tier-at-risk :05, cron-health-watcher :09, email-health-watcher :56) -- simultaneous
-- cold boots serialize in the edge runtime and cross pg_net's timeout, which is what
-- produced false "failing" alerts before the stagger.
DO $$ BEGIN
  PERFORM cron.unschedule('health-rollup') FROM cron.job WHERE jobname = 'health-rollup';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('health-rollup','7-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(
    url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/health-rollup',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()),
    body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'health-rollup', request_id FROM r;
$$);
