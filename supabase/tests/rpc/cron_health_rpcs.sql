-- Tests for the cron-health RPCs. cron_health_scan is service-role-only (data source for
-- the watcher); get_cron_health is super-admin-gated (the dashboard feed).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SELECT has_function('public', 'cron_health_scan', 'cron_health_scan exists');
SELECT has_function('public', 'get_cron_health', 'get_cron_health exists');

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-0009-0000-000000000000','authenticated','authenticated','ch-plain2@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.cron_health_state (job_name, status) VALUES ('offer-digest','failing');
SET session_replication_role = origin;

-- scan() returns no rows when there are no dispatches (and does not error on the net join).
-- Clear dispatch first for a deterministic empty state: in CI the cron_dispatch_capture
-- schedules can fire during the test run and insert rows. This DELETE is rolled back below.
DELETE FROM public.cron_health_dispatch;
SELECT is((SELECT count(*) FROM public.cron_health_scan())::int, 0, 'cron_health_scan returns 0 when there are no dispatches');

-- A job whose newest dispatch is still in flight must still report the outcome of its previous,
-- ANSWERED dispatch. This is what lets cron-health-watcher recover itself: its own dispatch is in
-- flight for the whole time it runs, so keying the outcome to the newest dispatch left it
-- permanently stuck "failing" (prod last_ok_at was frozen at 2026-06-24 while the edge logs showed
-- it returning 200 every 15 minutes).
SET session_replication_role = replica;
DELETE FROM public.cron_health_dispatch;
INSERT INTO net._http_response (id, status_code, timed_out, error_msg, created)
VALUES (900001, 200, false, NULL, now() - interval '20 minutes');
INSERT INTO public.cron_health_dispatch (job_name, request_id, dispatched_at)
VALUES ('cron-health-watcher', 900001, now() - interval '20 minutes'),  -- answered
       ('cron-health-watcher', 900002, now());                          -- in flight, no response row
SET session_replication_role = origin;

SELECT is(
  (SELECT status_code FROM public.cron_health_scan() WHERE job_name = 'cron-health-watcher'),
  200,
  'outcome comes from the newest ANSWERED dispatch, not the in-flight one'
);
SELECT ok(
  (SELECT dispatched_at > answered_at FROM public.cron_health_scan() WHERE job_name = 'cron-health-watcher'),
  'dispatched_at tracks the newest dispatch while answered_at tracks the answered one'
);

-- A job with dispatches but no answered one at all reports a NULL outcome, so the watcher skips it
-- rather than inventing a failure.
SET session_replication_role = replica;
DELETE FROM public.cron_health_dispatch;
INSERT INTO public.cron_health_dispatch (job_name, request_id, dispatched_at)
VALUES ('airtable-poll', 900003, now());
SET session_replication_role = origin;

SELECT ok(
  (SELECT responded_at IS NULL AND status_code IS NULL AND answered_at IS NULL
   FROM public.cron_health_scan() WHERE job_name = 'airtable-poll'),
  'a job with only in-flight dispatches reports a null outcome'
);

-- Volatility guard. cron_health_scan reads net._http_response, which pg_net's background worker
-- mutates outside the calling transaction, so it must be VOLATILE -- STABLE lets the planner cache
-- the rows within a statement and hide responses that landed mid-transaction. This regressed once
-- already: the DROP + CREATE that added answered_at was templated from the pre-fix body and shipped
-- STABLE. Nothing else in this suite would catch it, since every test calls the function fresh.
SELECT is(
  (SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cron_health_scan'),
  'v'::"char",
  'cron_health_scan is VOLATILE (it reads net._http_response, mutated outside the transaction)'
);

-- get_cron_health() is gated: a plain authenticated user gets zero rows even though state exists.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0009-0000-000000000000';
SELECT is((SELECT count(*) FROM public.get_cron_health())::int, 0, 'non-super-admin gets no cron health rows');

SELECT * FROM finish();
ROLLBACK;
