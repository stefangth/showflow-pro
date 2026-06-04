-- RLS tests for public.notifications.
--
-- Policies under test (source migrations):
--   "Users can view own notifications"           — 20260416115633
--   "Users can update own notifications"         — 20260416115633
--   "Admins and producers can insert notifs"     — 20260416115703
--                                                  (org-scoped in 20260603130200)
--
-- The org_isolation RESTRICTIVE policy (is_org_member) and the org-scoped insert
-- policy (has_org_role) both resolve through org_memberships, so members are seeded
-- in the bootstrap org.
--
-- UUID legend (all IDs rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist A user
--   aaaaaaaa-aaaa-0004-…  artist B user
--   ffffffff-0001-…       notification for artist A
--   ffffffff-0002-…       notification for artist B

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-nr-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-nr-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-nr-artista@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'authenticated', 'authenticated', 'rls-nr-artistb@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Roles as bootstrap-org memberships (the notifications insert policy uses
-- has_org_role, and the org_isolation policy uses is_org_member).
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0004-0000-000000000000','artist');

-- One notification per artist for isolation in SELECT tests
INSERT INTO public.notifications (id, user_id, type, title, message, org_id)
VALUES
  ('ffffffff-0001-0000-0000-000000000000', 'aaaaaaaa-aaaa-0003-0000-000000000000',
   'booking_confirmed', 'Booking confirmed', 'Your slot is confirmed.', '00000000-0000-0000-0000-00000000b007'),
  ('ffffffff-0002-0000-0000-000000000000', 'aaaaaaaa-aaaa-0004-0000-000000000000',
   'booking_confirmed', 'Booking confirmed', 'Your slot is confirmed.', '00000000-0000-0000-0000-00000000b007');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- notifications SELECT
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Artist A sees own notification
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE id = 'ffffffff-0001-0000-0000-000000000000'),
  1,
  'artist A sees own notification'
);

RESET ROLE;

-- 2. Artist B cannot see artist A's notification
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE id = 'ffffffff-0001-0000-0000-000000000000'),
  0,
  'artist B cannot see artist A notification'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- notifications INSERT
-- ────────────────────────────────────────────────────────────────────────────

-- 3. Admin can insert a notification
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.notifications (user_id, type, title, message, org_id)
    VALUES ('aaaaaaaa-aaaa-0003-0000-000000000000', 'test', 'Test', 'Test msg', '00000000-0000-0000-0000-00000000b007')$$,
  'admin can insert notification'
);

RESET ROLE;

-- 4. Producer can insert a notification
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.notifications (user_id, type, title, message, org_id)
    VALUES ('aaaaaaaa-aaaa-0003-0000-000000000000', 'test', 'Test', 'Test msg', '00000000-0000-0000-0000-00000000b007')$$,
  'producer can insert notification'
);

RESET ROLE;

-- 5. Artist cannot insert a notification (no INSERT policy for artist role)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.notifications (user_id, type, title, message, org_id)
    VALUES ('aaaaaaaa-aaaa-0003-0000-000000000000', 'test', 'Self-notify', 'Bad', '00000000-0000-0000-0000-00000000b007')$$,
  null, null,
  'artist cannot insert notification'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
