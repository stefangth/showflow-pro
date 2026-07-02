-- Tests for public.enforce_blocked_date_eligibility() trigger (M3)
-- (defined in 20260702120030_blocked_dates_eligibility_guard.sql)
--
-- The trigger is a BEFORE INSERT / BEFORE UPDATE OF (date, artist_id) guard on
-- blocked_dates that RAISEs when:
--   (1) the artist has an ACTIVE (non-cancelled) booking on that date, or
--   (2) the date is not in the artist's eligible set (per-date override OR
--       show+city eligibility, upcoming non-cancelled show_dates only) —
--       mirroring useArtistEligibleDates / open-offer-tier.
-- It is SECURITY DEFINER; we exercise it as superuser via plain INSERT/UPDATE.
--
-- Eligibility is seeded two ways to cover both branches:
--   • show+city  : cast X eligible for (show 1, city 1) → date d1 eligible
--   • per-date   : cast X override on date d2 (no city)  → date d2 eligible
-- Ineligible control: date d3 (a real show_date, no eligibility link).
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-bd00-000N-…  auth users
--   bbbbbbbb-bd00-000N-…  artist profiles
--   77777777-bd00-000N-…  casts
--   cccccccc-bd00-000N-…  shows
--   99999999-bd00-000N-…  cities
--   dddddddd-bd00-000N-…  show_dates
--   eeeeeeee-bd00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

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

INSERT INTO public.casts (id, name, org_id) VALUES
  ('77777777-bd00-0001-0000-000000000000', 'BDE Cast X', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.cast_members (cast_id, artist_id) VALUES
  ('77777777-bd00-0001-0000-000000000000', 'bbbbbbbb-bd00-0001-0000-000000000000');

INSERT INTO public.cities (id, name, org_id) VALUES
  ('99999999-bd00-0001-0000-000000000000', 'BDE City 1', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id) VALUES
  ('cccccccc-bd00-0001-0000-000000000000', 'theatre', 'bde', 10, 10, '00000000-0000-0000-0000-00000000b007');

-- Show dates. d1 eligible via show+city; d2 eligible via per-date override;
-- d3 a real upcoming date with NO eligibility link (ineligible control).
INSERT INTO public.show_dates (id, show_id, date, session_1, city_id, status, org_id) VALUES
  ('dddddddd-bd00-0001-0000-000000000000', 'cccccccc-bd00-0001-0000-000000000000', '2099-09-01', '19:00'::time, '99999999-bd00-0001-0000-000000000000', 'open', '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-bd00-0002-0000-000000000000', 'cccccccc-bd00-0001-0000-000000000000', '2099-09-02', '19:00'::time, NULL,                                     'open', '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-bd00-0003-0000-000000000000', 'cccccccc-bd00-0001-0000-000000000000', '2099-09-03', '19:00'::time, '99999999-bd00-0001-0000-000000000000', 'open', '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-bd00-0004-0000-000000000000', 'cccccccc-bd00-0001-0000-000000000000', '2099-09-04', '19:00'::time, '99999999-bd00-0001-0000-000000000000', 'open', '00000000-0000-0000-0000-00000000b007');

-- show+city eligibility → makes d1 AND d4 eligible (same show+city)
INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id) VALUES
  ('cccccccc-bd00-0001-0000-000000000000', '99999999-bd00-0001-0000-000000000000', '77777777-bd00-0001-0000-000000000000');

-- per-date override → makes d2 eligible (no city on d2)
INSERT INTO public.show_date_cast_eligibility (show_date_id, cast_id) VALUES
  ('dddddddd-bd00-0002-0000-000000000000', '77777777-bd00-0001-0000-000000000000');

-- Active booking on d4 (an eligible date) → booking-conflict on that date.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-bd00-0001-0000-000000000000', 'dddddddd-bd00-0004-0000-000000000000', 'bbbbbbbb-bd00-0001-0000-000000000000', 'soft_booked', false, '00000000-0000-0000-0000-00000000b007');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Happy path: eligible free dates succeed (both eligibility branches)
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-09-01', 'show+city eligible', '00000000-0000-0000-0000-00000000b007')$$,
  'test 1: blocking an eligible free date (show+city) succeeds'
);

SELECT lives_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-09-02', 'per-date override eligible', '00000000-0000-0000-0000-00000000b007')$$,
  'test 2: blocking an eligible free date (per-date override) succeeds'
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
-- Eligibility: a real upcoming date the artist is NOT eligible for is rejected
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-09-03', 'no eligibility link', '00000000-0000-0000-0000-00000000b007')$$,
  '23514',
  null,
  'test 4: blocking an ineligible show_date is rejected'
);

-- A date with no show_date at all is likewise ineligible.
SELECT throws_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason, org_id)
    VALUES ('bbbbbbbb-bd00-0001-0000-000000000000', '2099-12-25', 'no show that day', '00000000-0000-0000-0000-00000000b007')$$,
  '23514',
  null,
  'test 5: blocking a date with no show_date is rejected'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Reason-only UPDATE must not re-trigger the guard (does not touch date/artist).
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$UPDATE public.blocked_dates SET reason = 'edited reason'
    WHERE artist_id = 'bbbbbbbb-bd00-0001-0000-000000000000' AND date = '2099-09-01'$$,
  'test 6: reason-only UPDATE passes (guard not fired on date/artist unchanged)'
);

SELECT * FROM finish();
ROLLBACK;
