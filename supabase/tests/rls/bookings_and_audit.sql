-- RLS tests for public.bookings, public.booking_audit_log, and the
-- "Artists can respond to own offers" UPDATE policy.
--
-- Policies under test (source migrations):
--   "Admins and producers can manage bookings"   — 20260416115633
--   "Artists can view own bookings"              — 20260416115633
--   "Artists can respond to own offers"          — 20260514230000
--   "Admins/producers can view audit logs"       — 20260416115633, 20260416115703
--
-- UUID legend (all IDs are test-only, rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist A user
--   aaaaaaaa-aaaa-0004-…  artist B user
--   bbbbbbbb-bbbb-0001-…  artist A profile row
--   bbbbbbbb-bbbb-0002-…  artist B profile row
--   cccccccc-cccc-0001-…  show
--   dddddddd-dddd-0001-…  show_date
--   eeeeeeee-eeee-0001-…  booking: artist A, suggested   (visibility test)
--   eeeeeeee-eeee-0002-…  booking: artist B, suggested   (visibility test)
--   eeeeeeee-eeee-0003-…  booking: artist A, suggested   (update → soft_booked)
--   eeeeeeee-eeee-0004-…  booking: artist A, suggested   (illegal → confirmed)
--   eeeeeeee-eeee-0005-…  booking: artist A, confirmed   (USING blocks update)
--   eeeeeeee-eeee-0006-…  booking: artist A, suggested   (artist B can't update)
--   ffffffff-ffff-0001-…  booking_audit_log entry

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup (as postgres superuser)
-- session_replication_role = replica disables FK trigger checks and auth
-- triggers so we can insert minimal rows without real auth.users constraints.
-- The auth.users rows still land in the transaction snapshot and satisfy any
-- FK checks that run AFTER we reset the role back to DEFAULT.
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-artista@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-artistb@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());


-- Phase 1B: role-gating is now org-scoped (has_org_role). Domain rows below default
-- to the bootstrap org, so mirror the roles as bootstrap-org memberships.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0004-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id) VALUES
  ('bbbbbbbb-bbbb-0001-0000-000000000000', 'RLS Artist A', 'aaaaaaaa-aaaa-0003-0000-000000000000'),
  ('bbbbbbbb-bbbb-0002-0000-000000000000', 'RLS Artist B', 'aaaaaaaa-aaaa-0004-0000-000000000000');

INSERT INTO public.shows (id, program, sub_program)
VALUES ('cccccccc-cccc-0001-0000-000000000000', 'theatre', 'musical');

INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-dddd-0001-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-01', '20:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-eeee-0001-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false),
  ('eeeeeeee-eeee-0002-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0002-0000-000000000000', 'suggested'::booking_status, false),
  ('eeeeeeee-eeee-0003-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false),
  ('eeeeeeee-eeee-0004-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false),
  ('eeeeeeee-eeee-0005-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'confirmed'::booking_status, false),
  ('eeeeeeee-eeee-0006-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false);

INSERT INTO public.booking_audit_log (id, booking_id, action, old_status, new_status, performed_by)
VALUES (
  'ffffffff-ffff-0001-0000-000000000000',
  'eeeeeeee-eeee-0001-0000-000000000000',
  'status_change',
  'suggested'::booking_status,
  'soft_booked'::booking_status,
  'aaaaaaaa-aaaa-0001-0000-000000000000'
);

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Bookings SELECT visibility
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Admin sees any booking (including those belonging to other artists)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'admin sees artist B booking'
);

RESET ROLE;

-- 2. Producer sees any booking
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'producer sees artist A booking'
);

RESET ROLE;

-- 3. Artist A sees own booking
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'artist A sees own booking'
);

RESET ROLE;

-- 4. Artist B cannot see artist A's booking
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  0,
  'artist B cannot see artist A booking'
);

RESET ROLE;

-- 5. Artist cannot insert a booking directly (no INSERT policy for artist role)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy)
    VALUES (
      'dddddddd-dddd-0001-0000-000000000000',
      'bbbbbbbb-bbbb-0001-0000-000000000000',
      'suggested',
      false
    )$$,
  null, null,
  'artist cannot insert booking directly'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- booking_audit_log SELECT visibility
-- ────────────────────────────────────────────────────────────────────────────

-- 6. Admin can view audit log
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'admin can view booking_audit_log entry'
);

RESET ROLE;

-- 7. Producer can view audit log
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'producer can view booking_audit_log entry'
);

RESET ROLE;

-- 8. Artist cannot view audit log (no SELECT policy for artist role)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log),
  0,
  'artist sees zero booking_audit_log rows'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- "Artists can respond to own offers" UPDATE policy
-- ────────────────────────────────────────────────────────────────────────────

-- 9. Artist A can accept own suggested offer (→ soft_booked)
--    The notify_booking_transition SECURITY DEFINER trigger fires and writes
--    an audit row + notification for the admin fallback; both succeed because
--    the admin's auth.users row exists in this transaction.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000'),
  'soft_booked',
  'artist A can accept own offer (suggested → soft_booked)'
);

-- 10. Artist A cannot set own offer directly to confirmed (WITH CHECK blocks it)
--     USING passes (own booking, status = suggested) but WITH CHECK
--     only allows 'soft_booked' | 'cancelled', so PostgreSQL raises 42501.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'confirmed'
    WHERE id = 'eeeeeeee-eeee-0004-0000-000000000000'$$,
  '42501',
  null,
  'artist A cannot set own offer to confirmed (WITH CHECK violation)'
);

RESET ROLE;

-- 11. Artist A cannot update own confirmed booking
--     USING requires status = 'suggested'; confirmed booking is invisible to
--     the UPDATE, so 0 rows are affected and no error is raised.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE public.bookings SET status = 'soft_booked'
WHERE id = 'eeeeeeee-eeee-0005-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0005-0000-000000000000'),
  'confirmed',
  'confirmed booking unchanged — USING status=suggested blocked artist A'
);

-- 12. Artist B cannot update artist A's booking (USING artist_id check fails)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE public.bookings SET status = 'soft_booked'
WHERE id = 'eeeeeeee-eeee-0006-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0006-0000-000000000000'),
  'suggested',
  'artist A booking unchanged — USING artist_id check blocked artist B'
);

SELECT * FROM finish();
ROLLBACK;
