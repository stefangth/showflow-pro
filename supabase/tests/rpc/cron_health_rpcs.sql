-- Tests for the cron-health RPCs. cron_health_scan is service-role-only (data source for
-- the watcher); get_cron_health is super-admin-gated (the dashboard feed).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SELECT has_function('public', 'cron_health_scan', 'cron_health_scan exists');
SELECT has_function('public', 'get_cron_health', 'get_cron_health exists');

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-0009-0000-000000000000','authenticated','authenticated','ch-plain2@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.cron_health_state (job_name, status) VALUES ('offer-digest','failing');
SET session_replication_role = origin;

-- scan() returns no rows when there are no dispatches (and does not error on the net join).
SELECT is((SELECT count(*) FROM public.cron_health_scan())::int, 0, 'cron_health_scan returns 0 with no dispatches');

-- get_cron_health() is gated: a plain authenticated user gets zero rows even though state exists.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0009-0000-000000000000';
SELECT is((SELECT count(*) FROM public.get_cron_health())::int, 0, 'non-super-admin gets no cron health rows');

SELECT * FROM finish();
ROLLBACK;
