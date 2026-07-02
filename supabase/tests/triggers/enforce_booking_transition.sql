-- Tests for public.enforce_booking_transition() trigger (H3)
-- (defined in 20260702120020_booking_transition_guard.sql)
--
-- The trigger is a BEFORE UPDATE OF status guard that RAISEs on any illegal
-- (OLD.status → NEW.status) transition and lets legal ones + same-status /
-- non-status updates through. It is SECURITY DEFINER; we exercise it as superuser
-- via plain UPDATE statements.
--
-- Legal set: suggested→{soft_booked,cancelled}; soft_booked→{confirmed,cancelled};
-- confirmed→cancelled; nothing may leave cancelled. Understudy promotion (a
-- SECURITY DEFINER path that sets app.promoting_understudy) must still work.
--
-- Slots are set high (10 main + 10 understudy) so slot_fill_auto_cancel never fires
-- and interferes with the direct transitions under test; the understudy-promotion
-- test uses its own 1+1 show so a single confirm/cancel drives promotion.
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-eb00-000N-…  auth users
--   bbbbbbbb-eb00-000N-…  artist profiles
--   cccccccc-eb00-000N-…  shows
--   dddddddd-eb00-000N-…  show_dates (one per booking — avoids bookings_active_artist_date_uniq)
--   eeeeeeee-eb00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures
-- ────────────────────────────────────────────────────────────────────────────
SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-eb00-0001-0000-000000000000', 'authenticated', 'authenticated', 'ebt-admin@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-eb00-0002-0000-000000000000', 'authenticated', 'authenticated', 'ebt-artist@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-eb00-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-eb00-0002-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('bbbbbbbb-eb00-0001-0000-000000000000', 'EBT Artist 1', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-eb00-0002-0000-000000000000', 'EBT Artist 2', 'aaaaaaaa-eb00-0002-0000-000000000000', '00000000-0000-0000-0000-00000000b007');

-- High-slot show for the direct-transition bookings (no auto-cancel interference).
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-eb00-0001-0000-000000000000', 'theatre', 'guard-big', 10, 10, '00000000-0000-0000-0000-00000000b007');

-- 1+1 show for the understudy-promotion path.
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-eb00-0002-0000-000000000000', 'theatre', 'guard-small', 1, 1, '00000000-0000-0000-0000-00000000b007');

-- One show_date per booking (bookings_active_artist_date_uniq allows only one active
-- booking per (show_date, artist)).
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('dddddddd-eb00-0001-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0002-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-02', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0003-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-03', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0004-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-04', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0005-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-05', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0006-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-06', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0007-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-07', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0008-0000-000000000000', 'cccccccc-eb00-0001-0000-000000000000', '2099-08-08', '19:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-eb00-0009-0000-000000000000', 'cccccccc-eb00-0002-0000-000000000000', '2099-08-09', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

-- Bookings, one per scenario. Artist 1 is the subject; each lives on its own date.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-eb00-0001-0000-000000000000', 'dddddddd-eb00-0001-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'suggested',   false, '00000000-0000-0000-0000-00000000b007'), -- legal: suggested→soft_booked
  ('eeeeeeee-eb00-0002-0000-000000000000', 'dddddddd-eb00-0002-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'suggested',   false, '00000000-0000-0000-0000-00000000b007'), -- legal: suggested→cancelled
  ('eeeeeeee-eb00-0003-0000-000000000000', 'dddddddd-eb00-0003-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'soft_booked', false, '00000000-0000-0000-0000-00000000b007'), -- legal: soft_booked→confirmed
  ('eeeeeeee-eb00-0004-0000-000000000000', 'dddddddd-eb00-0004-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'soft_booked', false, '00000000-0000-0000-0000-00000000b007'), -- legal: soft_booked→cancelled
  ('eeeeeeee-eb00-0005-0000-000000000000', 'dddddddd-eb00-0005-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'confirmed',   false, '00000000-0000-0000-0000-00000000b007'), -- legal: confirmed→cancelled
  ('eeeeeeee-eb00-0006-0000-000000000000', 'dddddddd-eb00-0006-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'cancelled',   false, '00000000-0000-0000-0000-00000000b007'), -- illegal: cancelled→confirmed (resurrection)
  ('eeeeeeee-eb00-0007-0000-000000000000', 'dddddddd-eb00-0007-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'suggested',   false, '00000000-0000-0000-0000-00000000b007'), -- illegal: suggested→confirmed (skip a step)
  ('eeeeeeee-eb00-0008-0000-000000000000', 'dddddddd-eb00-0008-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'confirmed',   false, '00000000-0000-0000-0000-00000000b007'); -- illegal: confirmed→soft_booked + non-status/same-status passes

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Legal transitions succeed
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'soft_booked' WHERE id = 'eeeeeeee-eb00-0001-0000-000000000000'$$,
  'test 1: suggested → soft_booked is allowed'
);

SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-eb00-0002-0000-000000000000'$$,
  'test 2: suggested → cancelled is allowed'
);

SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-eb00-0003-0000-000000000000'$$,
  'test 3: soft_booked → confirmed is allowed'
);

SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-eb00-0004-0000-000000000000'$$,
  'test 4: soft_booked → cancelled is allowed'
);

SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-eb00-0005-0000-000000000000'$$,
  'test 5: confirmed → cancelled is allowed'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Illegal transitions raise
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-eb00-0006-0000-000000000000'$$,
  null, null,
  'test 6: cancelled → confirmed (resurrection) is rejected'
);

SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'soft_booked' WHERE id = 'eeeeeeee-eb00-0006-0000-000000000000'$$,
  null, null,
  'test 7: cancelled → soft_booked is rejected'
);

SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'suggested' WHERE id = 'eeeeeeee-eb00-0006-0000-000000000000'$$,
  null, null,
  'test 8: cancelled → suggested is rejected'
);

SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-eb00-0007-0000-000000000000'$$,
  null, null,
  'test 9: suggested → confirmed (skips soft_booked) is rejected'
);

SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'soft_booked' WHERE id = 'eeeeeeee-eb00-0008-0000-000000000000'$$,
  null, null,
  'test 10: confirmed → soft_booked (backwards) is rejected'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Same-status and non-status updates pass (do not trip the guard)
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-eb00-0008-0000-000000000000'$$,
  'test 11: same-status write (confirmed → confirmed) passes'
);

SELECT lives_ok(
  $$UPDATE public.bookings SET notes = 'non-status update' WHERE id = 'eeeeeeee-eb00-0008-0000-000000000000'$$,
  'test 12: non-status column update passes'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Understudy promotion (soft_booked → confirmed via the SECURITY DEFINER path)
-- still works through the guard.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-eb00-0009-0000-000000000000', 'dddddddd-eb00-0009-0000-000000000000', 'bbbbbbbb-eb00-0001-0000-000000000000', 'confirmed',   false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eb00-0010-0000-000000000000', 'dddddddd-eb00-0009-0000-000000000000', 'bbbbbbbb-eb00-0002-0000-000000000000', 'soft_booked', true,  '00000000-0000-0000-0000-00000000b007');

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-eb00-0009-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-eb00-0010-0000-000000000000'),
  'confirmed',
  'test 13: understudy promotion (soft_booked → confirmed) still works through the guard'
);

SELECT * FROM finish();
ROLLBACK;
