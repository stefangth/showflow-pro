-- RLS tests for the cron-health tables. The guard: only super-admins (platform_admins)
-- may SELECT; there is no write policy at all (writes come from pg_cron's postgres role
-- and the service-role watcher, both of which bypass RLS).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','ch-super@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000','authenticated','authenticated','ch-plain@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');
INSERT INTO public.cron_health_state (job_name, status) VALUES ('offer-digest','failing');
INSERT INTO public.cron_health_log (job_name, status_code, error) VALUES ('offer-digest', 404, 'HTTP 404');
SET session_replication_role = origin;

-- RLS enabled on all three tables.
SELECT is(relrowsecurity, true, 'RLS on cron_health_state')    FROM pg_class WHERE oid = 'public.cron_health_state'::regclass;
SELECT is(relrowsecurity, true, 'RLS on cron_health_dispatch') FROM pg_class WHERE oid = 'public.cron_health_dispatch'::regclass;
SELECT is(relrowsecurity, true, 'RLS on cron_health_log')      FROM pg_class WHERE oid = 'public.cron_health_log'::regclass;

-- Super-admin can read state + log.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0001-0000-000000000000';
SELECT is((SELECT count(*) FROM public.cron_health_state)::int, 1, 'super-admin reads cron_health_state');
SELECT is((SELECT count(*) FROM public.cron_health_log)::int,   1, 'super-admin reads cron_health_log');

-- Plain authenticated user reads nothing and cannot write.
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-0002-0000-000000000000';
SELECT is((SELECT count(*) FROM public.cron_health_state)::int, 0, 'non-super-admin sees no cron_health_state rows');
SELECT throws_ok($$ INSERT INTO public.cron_health_state(job_name, status) VALUES ('x','healthy') $$, NULL, 'non-super-admin cannot insert cron_health_state');

SELECT * FROM finish();
ROLLBACK;
