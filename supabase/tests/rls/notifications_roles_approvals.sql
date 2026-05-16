-- RLS tests for public.notifications, public.user_roles, and
-- public.user_approvals.
--
-- Policies under test (source migrations):
--   notifications:
--     "Users can view own notifications"           — 20260416115633
--     "Users can update own notifications"         — 20260416115633
--     "Admins and producers can insert notifs"     — 20260416115703
--   user_roles:
--     "Users can view own roles"                   — 20260416115633
--     "Admins can view all roles"                  — 20260416115633
--     "Admins can manage roles"                    — 20260416115633
--     "Producers can view all roles"               — 20260515110000
--   user_approvals:
--     "Users can view own approval"                — 20260423102746
--     "Admins can view all approvals"              — 20260423102746
--     "Admins can update approvals"                — 20260423102746
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

SELECT plan(12);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'rls-nr-admin@test.com',    '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'rls-nr-producer@test.com', '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'rls-nr-artista@test.com',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'rls-nr-artistb@test.com',  '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'admin'::app_role),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'producer'::app_role),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'artist'::app_role),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'artist'::app_role);

-- One notification per artist for isolation in SELECT tests
INSERT INTO public.notifications (id, user_id, type, title, message)
VALUES
  ('ffffffff-0001-0000-0000-000000000000', 'aaaaaaaa-aaaa-0003-0000-000000000000',
   'booking_confirmed', 'Booking confirmed', 'Your slot is confirmed.'),
  ('ffffffff-0002-0000-0000-000000000000', 'aaaaaaaa-aaaa-0004-0000-000000000000',
   'booking_confirmed', 'Booking confirmed', 'Your slot is confirmed.');

-- One approval per user (normally created by handle_new_user trigger, which
-- is bypassed under replica mode — insert manually).
INSERT INTO public.user_approvals (user_id, email, status, requested_role)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'rls-nr-admin@test.com',    'approved'::approval_status, 'admin'::app_role),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'rls-nr-producer@test.com', 'approved'::approval_status, 'producer'::app_role),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'rls-nr-artista@test.com',  'pending'::approval_status,  'artist'::app_role),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'rls-nr-artistb@test.com',  'pending'::approval_status,  'artist'::app_role);

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
  $$INSERT INTO public.notifications (user_id, type, title, message)
    VALUES ('aaaaaaaa-aaaa-0003-0000-000000000000', 'test', 'Test', 'Test msg')$$,
  'admin can insert notification'
);

RESET ROLE;

-- 4. Producer can insert a notification
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.notifications (user_id, type, title, message)
    VALUES ('aaaaaaaa-aaaa-0003-0000-000000000000', 'test', 'Test', 'Test msg')$$,
  'producer can insert notification'
);

RESET ROLE;

-- 5. Artist cannot insert a notification (no INSERT policy for artist role)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.notifications (user_id, type, title, message)
    VALUES ('aaaaaaaa-aaaa-0003-0000-000000000000', 'test', 'Self-notify', 'Bad')$$,
  null, null,
  'artist cannot insert notification'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- user_roles SELECT
-- ────────────────────────────────────────────────────────────────────────────

-- 6. Artist A can view own role row
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_roles
   WHERE user_id = 'aaaaaaaa-aaaa-0003-0000-000000000000'),
  1,
  'artist A can view own user_role row'
);

RESET ROLE;

-- 7. Artist A cannot view admin's role row (only own-row policy applies for artists)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_roles
   WHERE user_id = 'aaaaaaaa-aaaa-0001-0000-000000000000'),
  0,
  'artist A cannot view admin role row'
);

RESET ROLE;

-- 8. Admin can view all role rows
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_roles),
  4,
  'admin sees all 4 user_role rows'
);

RESET ROLE;

-- 9. Producer can view all role rows (policy added in 20260515110000)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_roles),
  4,
  'producer sees all 4 user_role rows'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- user_approvals SELECT
-- ────────────────────────────────────────────────────────────────────────────

-- 10. Artist A sees own approval row
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_approvals
   WHERE user_id = 'aaaaaaaa-aaaa-0003-0000-000000000000'),
  1,
  'artist A sees own user_approval row'
);

RESET ROLE;

-- 11. Artist B cannot see artist A's approval
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_approvals
   WHERE user_id = 'aaaaaaaa-aaaa-0003-0000-000000000000'),
  0,
  'artist B cannot see artist A user_approval'
);

RESET ROLE;

-- 12. Admin sees all approval rows
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.user_approvals),
  4,
  'admin sees all 4 user_approval rows'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
