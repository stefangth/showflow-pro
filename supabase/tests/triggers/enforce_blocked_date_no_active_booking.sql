-- Tests for public.enforce_blocked_date_no_active_booking() trigger (M3)
-- (defined in 20260702120030_blocked_dates_eligibility_guard.sql)
--
-- The trigger is a BEFORE INSERT / BEFORE UPDATE OF (date, artist_id) guard on
-- blocked_dates that RAISEs (SQLSTATE 23514) when the artist has an ACTIVE
-- (non-cancelled) booking on that date. It enforces ONLY the booking conflict —
-- eligibility is intentionally NOT server-enforced (a block on a non-eligible
-- date is inert; the client picker remains the eligibility UX guide). So a block
-- on ANY date without a booking conflict succeeds, even a date with no show_date.
-- The function is SECURITY DEFINER; we exercise it as superuser via plain
-- INSERT/UPDATE.
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-bd00-000N-…  auth users
--   bbbbbbbb-bd00-000N-…  artist profiles
--   cccccccc-bd00-000N-…  shows
--   99999999-bd00-000N-…  cities
--   dddddddd-bd00-000N-…  show_dates
--   eeeeeeee-bd00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(4);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures (as postgres superuser; replica disables FK/auth triggers)
-- ────────────────────────────────────────────────────────────────────────────
SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-bd00-0003-0000-000000000000', 'authenticated', 'authenticated', 'bde-artista@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-bd00-0003-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id, org_id, status) VALUES
  ('bbbbbbbb-bd00-0001-0000-000000000000', 'BDE Artist A', 'aaaaaaaa-bd00-0003-0000-000000000000', '00000000-0000-0000-0000-00000000b007', 'active');

INSERT INTO public.cities (id, name, org_id) VALUES
  ('99999999-bd00-0001-0000-000000000000', 'BDE City 1', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id) VALUES
  ('cccccccc-bd00-0001-0000-000000000000', 'theatre', 'bde', 10, 10, '00000000-0000-0000-0000-00000000b007');

-- Show dates. d1 is a free upcoming date (no booking); d4 carries the active
-- booking that must produce the conflict.
INSERT INTO public.show_dates (id, show_id, date, session_1, city_id, status, org_id) VALUES
  ('dddddddd-bd00-0001-0000-000000000000', 'cccccccc-bd00-0001-0000-000000000000', '2099-09-01', '19:00'::time, '99999999-bd00-0001-0000-000000000000', 'open', '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-bd00-0004-0000-000000000000', 'cccccccc-bd00-0001-0000-000000000000', '2099-09-04', '19:00'::time, '99999999-bd00-0001-0000-000000000000', 'open', '00000000-0000-0000-0000-00000000b007');

-- Active booking on d4 → booking-conflict on that date.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-bd00-0001-0000-000000000000', 'dddddddd-bd00-0004-0000-000000000000', 'bbbbbbbb-bd00-0001-0000-000000000000', 'soft_booked', false, '00000000-0000-0000-0000-00000000b007');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Happy path: any date without a booking conflict succeeds (eligibility is NOT
-- enforced), including a date the artist has no show_date/eligibility link on.
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-09-01', 'free date', '00000000-0000-0000-0000-00000000b007')$$,
  'test 1: blocking a free date (no active booking) succeeds'
);

SELECT lives_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-12-25', 'no show that day', '00000000-0000-0000-0000-00000000b007')$$,
  'test 2: blocking a date with no show_date succeeds (eligibility not enforced)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Booking-conflict: date with an active booking is rejected
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-09-04', 'has active booking', '00000000-0000-0000-0000-00000000b007')$$,
  '23514',
  null,
  'test 3: blocking a date with an active booking is rejected'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Reason-only UPDATE must not re-trigger the guard (does not touch date/artist).
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$UPDATE public.blocked_dates SET reason = 'edited reason'
    WHERE artist_id = 'bbbbbbbb-bd00-0001-0000-000000000000' AND date = '2099-09-01'$$,
  'test 4: reason-only UPDATE passes (guard not fired on date/artist unchanged)'
);

SELECT * FROM finish();
ROLLBACK;
