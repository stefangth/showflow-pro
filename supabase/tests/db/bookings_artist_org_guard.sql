-- A booking's artist must belong to the same org as its show_date.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(2);

-- Org A: a show + date
INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-artist-guard');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
-- Same-org artist (positive case)
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Same Org Artist', 'active');
-- Org B: an artist that must NOT be bookable onto Org A's date
INSERT INTO public.organizations (id, name, slug)
  VALUES ('66666666-6666-6666-6666-666666666666', 'Org B', 'org-b-artist-guard');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'Cross Org Artist', 'active');

-- 1) booking Org A's date with Org B's artist is rejected
SELECT throws_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', 'suggested') $$,
  'P0001', NULL,
  'booking an out-of-org artist is rejected');

-- 2) booking with a same-org artist succeeds
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested') $$,
  'booking a same-org artist succeeds');

SELECT * FROM finish();
ROLLBACK;
