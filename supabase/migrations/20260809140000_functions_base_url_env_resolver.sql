-- Route every in-DB edge-function dispatch through an environment-resolved base URL so that
-- non-production stacks (local dev via `npm run local:up`, CI via `supabase start`, and any
-- Supabase preview branch) stop firing pg_cron / trigger net.http_post calls at PRODUCTION.
--
-- Background: the scheduling migrations hardcoded the production host
-- (https://epweartpzwvcasrzyueh.supabase.co/functions/v1/...) with no environment guard, and
-- 00000000000000_local_extensions.sql deliberately enables pg_cron + pg_net on local/CI so those
-- migrations run there too. Each foreign stack therefore dispatched at production with its own
-- freshly-minted private.cron_secret() (gen_random_bytes, see 20260702120010), which never matches
-- prod -> requireCronSecret rejects them 401. Those 401s polluted prod's function_edge_logs and drove
-- the System Health console to "degraded".
-- See docs/superpowers/specs/2026-08-09-cron-401-degraded-design.md.
--
-- This migration changes only HOW the URL string is built. On production the resolver returns the
-- production host (unchanged behavior). supabase/seed.sql (local + preview only, never prod) sets an
-- app.functions_base_url override to the local stack. Schedules, 90s timeouts, X-Cron-Secret headers
-- and the cron_health_dispatch capture are all preserved (guarded by cron_schedule_stagger.sql and
-- cron_dispatch_timeout.sql).
--
-- NOTE on scope: the design's Task 3 (routing the on_auth_user_created notify-signup dispatcher
-- through this same resolver) does not apply. That dispatcher was retired outright by
-- 20260603140000_retire_approval_flow.sql, which replaced public.handle_new_user with a profile-only
-- body that no longer calls net.http_post at all -- the notify-signup edge function itself no longer
-- exists under supabase/functions/. There is nothing left for this migration to touch there, so it is
-- intentionally skipped rather than reintroducing a dispatch call that was deliberately removed.

-- 1) Resolver: read the override from a table, not a GUC. seed.sql runs as the non-owner
--    `postgres` role, which cannot `ALTER DATABASE/ROLE ... SET` a parameter (fails with
--    SQLSTATE 42501 on the Supabase stack, local and CI), but can INSERT into a table this
--    migration owns. Default (no row present) is the production host -- the single place it
--    lives. Fail-safe: a missing override can only ever mis-target local, never prod.
create table if not exists private.runtime_config (
  key   text primary key,
  value text not null
);

create or replace function private.functions_base_url()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(value, '') from private.runtime_config where key = 'functions_base_url'),
    'https://epweartpzwvcasrzyueh.supabase.co'
  );
$$;

-- 2) Reschedule every HTTP-dispatching cron job to build its URL via the resolver. Identical
--    schedules, timeouts, headers and dispatch-capture as 20260728135342 / 20260804181035.
DO $$ BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                    'tier-at-risk-hourly','airtable-poll','cron-health-watcher',
                    'email-health-watcher','health-rollup');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('expire-offers-hourly','0 * * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/expire-offers',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'expire-offers-hourly', request_id FROM r;
$$);

SELECT cron.schedule('airtable-poll','2-59/5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/airtable-poll',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'airtable-poll', request_id FROM r;
$$);

SELECT cron.schedule('offer-digest','3 16-19 * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/send-offer-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'offer-digest', request_id FROM r;
$$);

SELECT cron.schedule('confirmation-digest','4 17-20 * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/send-confirmation-digest',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'confirmation-digest', request_id FROM r;
$$);

SELECT cron.schedule('tier-at-risk-hourly','5 * * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/tier-at-risk-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'tier-at-risk-hourly', request_id FROM r;
$$);

SELECT cron.schedule('cron-health-watcher','9-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/cron-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'cron-health-watcher', request_id FROM r;
$$);

SELECT cron.schedule('email-health-watcher','11-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/email-health-watcher',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'email-health-watcher', request_id FROM r;
$$);

SELECT cron.schedule('health-rollup','7-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(url:=private.functions_base_url() || '/functions/v1/health-rollup',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()), body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'health-rollup', request_id FROM r;
$$);

-- 3) Trigger dispatcher: hire-order auto-draft uses the resolver too. Body identical to
--    20260717161030 except the URL.
create or replace function public.dispatch_hire_order_drafts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'fully_filled' or old.status = 'fully_filled' then
    return null;
  end if;
  if not public.is_feature_enabled(new.org_id, 'hire_orders') then
    return null;
  end if;
  perform net.http_post(
    url := private.functions_base_url() || '/functions/v1/generate-hire-orders',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()),
    body := jsonb_build_object('action','draft','org_id', new.org_id,'show_date_id', new.id,'notify', true),
    timeout_milliseconds := 30000
  );
  return null;
end;
$$;
