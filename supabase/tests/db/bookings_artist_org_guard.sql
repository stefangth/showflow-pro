-- Two layers guard a booking's refs:
--   1. trg_derive_org_id (INSERT + UPDATE of refs/org_id): org_id derives from the
--      show_date and the artist must belong to that org (raises P0001 on mismatch).
--   2. enforce_booking_immutable_refs (UPDATE of show_date_id/artist_id, added by
--      20260714220415_bookings_retarget_guard.sql): the refs are immutable after
--      creation (raises 23514). It fires FIRST on UPDATE (trigger name order), so
--      every post-creation retarget, same-org or cross-org, is rejected with 23514.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

-- Org A: a show with two dates and two artists
INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-artist-guard');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('3a3a3a3a-3a3a-3a3a-3a3a-3a3a3a3a3a3a', '22222222-2222-2222-2222-222222222222', '2026-07-02', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Org A Artist One', 'active');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b', '11111111-1111-1111-1111-111111111111', 'Org A Artist Two', 'active');
-- Org B: a show, a date, and an artist (all foreign to Org A)
INSERT INTO public.organizations (id, name, slug)
  VALUES ('66666666-6666-6666-6666-666666666666', 'Org B', 'org-b-artist-guard');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('88888888-8888-8888-8888-888888888888', '66666666-6666-6666-6666-666666666666', 'BOL', 'BOL: PP', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', '2026-07-03', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'Org B Artist', 'active');
-- A valid Org A booking to mutate in the UPDATE tests (Org A artist two on Org A date two)
INSERT INTO public.bookings (id, show_date_id, artist_id, status)
  VALUES ('55555555-5555-5555-5555-555555555555', '3a3a3a3a-3a3a-3a3a-3a3a-3a3a3a3a3a3a', '4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b', 'suggested');

-- 1) INSERT: Org A date with Org B artist is rejected
SELECT throws_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '77777777-7777-7777-7777-777777777777', 'suggested') $$,
  'P0001', NULL,
  'INSERT: out-of-org artist is rejected');

-- 2) INSERT: same-org artist succeeds
SELECT lives_ok(
  $$ INSERT INTO public.bookings (show_date_id, artist_id, status)
     VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'suggested') $$,
  'INSERT: same-org artist succeeds');

-- 3) UPDATE: reassigning artist_id post-creation is rejected by the immutability
--    guard (23514; it fires before the derive trigger, so even the out-of-org case
--    surfaces as an immutability violation now)
SELECT throws_ok(
  $$ UPDATE public.bookings SET artist_id = '77777777-7777-7777-7777-777777777777'
     WHERE id = '55555555-5555-5555-5555-555555555555' $$,
  '23514', NULL,
  'UPDATE: reassigning to an out-of-org artist is rejected');

-- 4) UPDATE: moving the booking to an out-of-org date is rejected (immutability
--    guard, 23514)
SELECT throws_ok(
  $$ UPDATE public.bookings SET show_date_id = '99999999-9999-9999-9999-999999999999'
     WHERE id = '55555555-5555-5555-5555-555555555555' $$,
  '23514', NULL,
  'UPDATE: moving the booking to an out-of-org date is rejected');

-- 5) UPDATE: moving the booking to another SAME-org date is now also rejected.
--    Deliberate contract reversal (20260714220415): the old behavior let an artist
--    retarget their own suggested booking onto any same-org date and self-book it,
--    bypassing eligibility and review. Refs are immutable after creation.
SELECT throws_ok(
  $$ UPDATE public.bookings SET show_date_id = '33333333-3333-3333-3333-333333333333'
     WHERE id = '55555555-5555-5555-5555-555555555555' $$,
  '23514', NULL,
  'UPDATE: moving the booking to a same-org date is rejected (immutable refs)');

-- 6) UPDATE: tampering org_id alone (the booking stays on Org A date two; test 5's
--    retarget is rejected) is re-derived from the show_date, so the client-supplied
--    Org B value is overwritten back to Org A. An org_id-only UPDATE skips the
--    immutability guard (it watches show_date_id/artist_id) and is handled by
--    trg_derive_org_id, which includes org_id in its column list since Fix 4.
UPDATE public.bookings SET org_id = '66666666-6666-6666-6666-666666666666'
  WHERE id = '55555555-5555-5555-5555-555555555555';
SELECT is(
  (SELECT org_id FROM public.bookings WHERE id = '55555555-5555-5555-5555-555555555555'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'UPDATE: tampering org_id alone is overwritten by re-derivation from the show_date');

SELECT * FROM finish();
ROLLBACK;
