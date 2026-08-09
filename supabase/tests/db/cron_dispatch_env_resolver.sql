-- Guard: no in-DB edge-function dispatcher may hardcode the production host; they must resolve it at
-- dispatch time via private.functions_base_url(), and the resolver must default to production when no
-- override row exists. Regression guard for 20260809140000_functions_base_url_env_resolver.
--
-- NOTE: the on_auth_user_created notify-signup dispatcher (introduced in
-- 20260423103651_3100e13e-9907-4d33-b74a-1dc3d0017262.sql) is not covered here because it no longer
-- exists: 20260603140000_retire_approval_flow.sql replaced public.handle_new_user with a profile-only
-- body that makes no net.http_post call at all, and the notify-signup edge function itself is gone
-- from supabase/functions/. dispatch_hire_order_drafts is the only remaining trigger dispatcher.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE command LIKE '%epweartpzwvcasrzyueh.supabase.co%'),
  0, 'no cron job command hardcodes the production functions host');

SELECT is(
  (SELECT count(*)::int FROM cron.job
   WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly','tier-at-risk-hourly',
                     'airtable-poll','cron-health-watcher','email-health-watcher','health-rollup')
     AND command NOT LIKE '%private.functions_base_url()%'),
  0, 'every dispatch job builds its URL via private.functions_base_url()');

-- Trigger dispatchers route through the resolver too (no hardcoded prod host in their bodies).
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('dispatch_hire_order_drafts')
     AND pg_get_functiondef(p.oid) LIKE '%epweartpzwvcasrzyueh.supabase.co%'),
  0, 'trigger dispatchers use the resolver, not a hardcoded prod host');

DELETE FROM private.runtime_config WHERE key = 'functions_base_url';  -- rolled back with this txn
SELECT is(private.functions_base_url(), 'https://epweartpzwvcasrzyueh.supabase.co',
          'functions_base_url() defaults to the production host when no override row exists');

SELECT * FROM finish();
ROLLBACK;
