-- Tests for public.notify_booking_transition() trigger
-- (defined in 20260514240000_booking_notification_trigger.sql,
--  security fixed in 20260515120000_fix_notify_booking_transition_security.sql)
--
-- The trigger is SECURITY DEFINER so it bypasses RLS — we can invoke it as
-- superuser via plain UPDATE statements.
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-ab00-0001-…  admin user
--   aaaaaaaa-ab00-0002-…  producer user
--   aaaaaaaa-ab00-0003-…  artist user
--   bbbbbbbb-ab00-0001-…  artist profile row
--   cccccccc-ab00-0001-…  show
--   dddddddd-ab00-0001-…  show_date
--   eeeeeeee-ab00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures (superuser; bypass FK triggers with replica role)
-- ────────────────────────────────────────────────────────────────────────────
-- Set slot capacity high enough that slot_fill_auto_cancel_trigger never
-- fires during this test. Without this, confirming booking 2 hits the NULL
-- guard bug (empty app_settings → v_main_cast = NULL → guard evaluates to
-- NULL not TRUE → falls through to cancel other bookings → test 7 fails).
INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre":{"musical":{"main_cast":10,"understudies":10}}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-ab00-0001-0000-000000000000', 'authenticated', 'authenticated', 'nbt-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-ab00-0002-0000-000000000000', 'authenticated', 'authenticated', 'nbt-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-ab00-0003-0000-000000000000', 'authenticated', 'authenticated', 'nbt-artist@test.com',   now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-ab00-0001-0000-000000000000', 'admin'::app_role),
  ('aaaaaaaa-ab00-0002-0000-000000000000', 'producer'::app_role),
  ('aaaaaaaa-ab00-0003-0000-000000000000', 'artist'::app_role);

INSERT INTO public.artists (id, name, user_id)
VALUES ('bbbbbbbb-ab00-0001-0000-000000000000', 'NBT Artist', 'aaaaaaaa-ab00-0003-0000-000000000000');

INSERT INTO public.shows (id, program, sub_program)
VALUES ('cccccccc-ab00-0001-0000-000000000000', 'theatre', 'musical');

INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ab00-0001-0000-000000000000', 'cccccccc-ab00-0001-0000-000000000000', '2099-07-01', '19:00'::time);

-- Booking 1: will be transitioned suggested → soft_booked
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('eeeeeeee-ab00-0001-0000-000000000000', 'dddddddd-ab00-0001-0000-000000000000', 'bbbbbbbb-ab00-0001-0000-000000000000', 'suggested', false);

-- Booking 2: will be transitioned soft_booked → confirmed
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('eeeeeeee-ab00-0002-0000-000000000000', 'dddddddd-ab00-0001-0000-000000000000', 'bbbbbbbb-ab00-0001-0000-000000000000', 'soft_booked', false);

-- Booking 3: no status change (notes update only)
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('eeeeeeee-ab00-0003-0000-000000000000', 'dddddddd-ab00-0001-0000-000000000000', 'bbbbbbbb-ab00-0001-0000-000000000000', 'suggested', false);

-- Booking 4: suggested → cancelled
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('eeeeeeee-ab00-0004-0000-000000000000', 'dddddddd-ab00-0001-0000-000000000000', 'bbbbbbbb-ab00-0001-0000-000000000000', 'suggested', false);

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: suggested → soft_booked inserts one booking_audit_log row
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = 'eeeeeeee-ab00-0001-0000-000000000000';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = 'eeeeeeee-ab00-0001-0000-000000000000'),
  1,
  'test 1: suggested→soft_booked inserts one audit row'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: Audit row has correct old_status and new_status
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT old_status::text || '→' || new_status::text
   FROM public.booking_audit_log
   WHERE booking_id = 'eeeeeeee-ab00-0001-0000-000000000000'
   LIMIT 1),
  'suggested→soft_booked',
  'test 2: audit row has correct old_status and new_status'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: suggested → soft_booked with no show_assignments → admin gets
--         fallback notification (type = 'booking_ready_to_confirm')
-- ────────────────────────────────────────────────────────────────────────────
-- No show_assignments rows exist → trigger falls back to admins.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = 'aaaaaaaa-ab00-0001-0000-000000000000'
     AND type = 'booking_ready_to_confirm'
     AND related_entity_id = 'eeeeeeee-ab00-0001-0000-000000000000'),
  1,
  'test 3: fallback admin notification created on suggested→soft_booked'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: soft_booked → confirmed inserts one booking_audit_log row
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'confirmed'
WHERE id = 'eeeeeeee-ab00-0002-0000-000000000000';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = 'eeeeeeee-ab00-0002-0000-000000000000'),
  1,
  'test 4: soft_booked→confirmed inserts one audit row'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: soft_booked → confirmed inserts notification for the artist
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE user_id = 'aaaaaaaa-ab00-0003-0000-000000000000'
     AND type = 'booking_confirmed'
     AND related_entity_id = 'eeeeeeee-ab00-0002-0000-000000000000'),
  1,
  'test 5: artist receives notification on soft_booked→confirmed'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6: Notification type is 'booking_confirmed'
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT type FROM public.notifications
   WHERE user_id = 'aaaaaaaa-ab00-0003-0000-000000000000'
     AND related_entity_id = 'eeeeeeee-ab00-0002-0000-000000000000'
   LIMIT 1),
  'booking_confirmed',
  'test 6: notification type is booking_confirmed'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7: No status change → no audit row inserted
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET notes = 'non-status update'
WHERE id = 'eeeeeeee-ab00-0003-0000-000000000000';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = 'eeeeeeee-ab00-0003-0000-000000000000'),
  0,
  'test 7: no status change — no audit row inserted'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 8: suggested → cancelled inserts one audit row
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'cancelled'
WHERE id = 'eeeeeeee-ab00-0004-0000-000000000000';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = 'eeeeeeee-ab00-0004-0000-000000000000'),
  1,
  'test 8: suggested→cancelled inserts one audit row'
);

SELECT * FROM finish();
ROLLBACK;
