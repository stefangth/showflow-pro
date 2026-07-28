-- Give every HTTP-dispatching cron job its own minute, and raise the pg_net dispatch timeout
-- from 30s to 90s.
--
-- Before this, `*/5` (airtable-poll), `*/15` (cron-health-watcher, email-health-watcher) and
-- `0 * * * *` (expire-offers) all fired at :00, six jobs during digest hours. The edge runtime
-- serializes those simultaneous cold boots at roughly 10s each, so completions ladder (13:00 batch
-- measured 2026-07-28: +1.9s, +10.3s, +20.2s, +29.3s) and the later slots cross pg_net's ceiling.
-- pg_net then records `timed_out` even though the function returns 200 seconds later (observed:
-- 200 at 33.3s, 34.9s, 43.6s, 44.2s), and cron-health-watcher reports those as `failing` and pages
-- super-admins. Failure rate was 0/216 at 1-2 concurrent dispatches vs 8/76 at 4-way.
--
-- Digest hour fields are unchanged, so the Berlin-hour gates inside the digest functions still
-- behave identically. Idempotent (unschedule-if-exists + reschedule); headers, the cron secret and
-- the dispatch-capture INSERT are unchanged. Supersedes 20260624101342_cron_dispatch_timeout.sql
-- and 20260711000837_email_health_watcher_cron.sql.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                    'tier-at-risk-hourly','airtable-poll','cron-health-watcher','email-health-watcher');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('expire-offers-hourly','0 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/expire-offers',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'expire-offers-hourly', request_id FROM r;
$$);

SELECT cron.schedule('airtable-poll','2-59/5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/airtable-poll',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'airtable-poll', request_id FROM r;
$$);

SELECT cron.schedule('offer-digest','3 16-19 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-offer-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'offer-digest', request_id FROM r;
$$);

SELECT cron.schedule('confirmation-digest','4 17-20 * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-confirmation-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'confirmation-digest', request_id FROM r;
$$);

SELECT cron.schedule('tier-at-risk-hourly','5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/tier-at-risk-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'tier-at-risk-hourly', request_id FROM r;
$$);

SELECT cron.schedule('cron-health-watcher','9-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/cron-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'cron-health-watcher', request_id FROM r;
$$);

SELECT cron.schedule('email-health-watcher','11-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/email-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'email-health-watcher', request_id FROM r;
$$);
