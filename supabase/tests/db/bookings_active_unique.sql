-- One active (non-cancelled) booking per (show_date, artist) is a DB guarantee.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-active-uniq');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Artist One', 'active');
INSERT INTO public.bookings (id, show_date_id, artist_id, status)
  VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested');

-- 1) a second ACTIVE booking for the same (show_date, artist) is rejected
SELECT throws_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'soft_booked') $$,
  '23505', NULL,
  'second active booking for same (show_date, artist) is rejected');

-- 2) a CANCELLED duplicate is allowed (partial index excludes cancelled)
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'cancelled') $$,
  'cancelled duplicate is allowed');

-- 3) after the active one is cancelled, a fresh active booking is allowed (re-offer)
UPDATE public.bookings SET status = 'cancelled' WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested') $$,
  're-offer after cancellation is allowed');

SELECT * FROM finish();
ROLLBACK;
