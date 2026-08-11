-- Tests for public.compute_show_date_status() and the sync_show_date_status_trigger
-- (defined in migrations; updated in Phase 1b-DB to read slots from shows columns).
--
-- The function:
--   - reads main_cast_slots / understudy_slots from shows.main_cast_slots / shows.understudy_slots
--   - counts confirmed bookings on the show_date, split by is_understudy
--   - sets show_dates.status to:
--       'fully_filled'     if confirmed_main >= main_cap AND confirmed_us >= us_cap
--       'partially_filled' if any non-cancelled booking exists
--       'open'             otherwise
--   - never overwrites 'cancelled'
--   - when main_cast_slots is NULL, never reaches 'fully_filled' (unconfigured)
--   - a main-only show (understudy_slots NULL) counts understudies as 0, so it CAN
--     reach 'fully_filled' once the main slots are confirmed

BEGIN;

-- pgTAP must be loaded before plan() can be called. Some CLI versions
-- auto-load it; doing it here makes the file portable.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

-- Configured show: theatre/musical needs 2 main + 1 understudy (columns on shows)
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'theatre', 'musical', 2, 1, '00000000-0000-0000-0000-00000000b007');

-- Unconfigured show: NULL slots → cannot reach fully_filled
INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('11111111-1111-1111-1111-111111111112', 'theatre', 'comedy', '00000000-0000-0000-0000-00000000b007');

-- Main-only show: 2 main + NULL understudy → configured (understudy optional)
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('11111111-1111-1111-1111-111111111113', 'theatre', 'solo', 2, NULL, '00000000-0000-0000-0000-00000000b007');

-- Four artists for stacking bookings on the same date
INSERT INTO public.artists (id, name, org_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'Artist 1', '00000000-0000-0000-0000-00000000b007'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'Artist 2', '00000000-0000-0000-0000-00000000b007'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'Artist 3', '00000000-0000-0000-0000-00000000b007'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'Artist 4', '00000000-0000-0000-0000-00000000b007');

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: Configured, no bookings → 'open'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-06-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

-- No booking trigger fires (no bookings). Call the function directly.
SELECT public.compute_show_date_status('22222222-0000-0000-0000-000000000001'::uuid);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000001'),
  'open',
  'no bookings → open'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: One suggested booking → 'partially_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026-06-02', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id)
VALUES ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'suggested', false, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000002'),
  'partially_filled',
  'one suggested booking → partially_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: Exact capacity (2 main + 1 understudy confirmed) → 'fully_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '2026-06-03', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', true, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000003'),
  'fully_filled',
  'exact capacity (2 main + 1 understudy) → fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: Main cast met but understudy missing → 'partially_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '2026-06-04', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000004'),
  'partially_filled',
  '2 main + 0 understudy → partially_filled (understudy slot not met)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: Over capacity on main (3 confirmed main, 1 understudy) → 'fully_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '2026-06-05', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'confirmed', true, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000005'),
  'fully_filled',
  'over-capacity main (3 of 2) + understudy → fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6: 'cancelled' is never overwritten
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, status, org_id)
VALUES ('22222222-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '2026-06-06', '19:00'::time, 'cancelled', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', true, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000006'),
  'cancelled',
  'cancelled status is never overwritten by the trigger'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7: Unconfigured (program, sub_program) → caps at 'partially_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111112', '2026-06-07', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', true, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000007'),
  'partially_filled',
  'unconfigured (program, sub_program) never reaches fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 8: Cancelled bookings do not count toward thresholds
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '2026-06-08', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'cancelled', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'cancelled', true, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000008'),
  'partially_filled',
  'cancelled bookings ignored — only 1 confirmed main counts'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 9: Main-only show (understudy_slots NULL), main slots confirmed → 'fully_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('22222222-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111113', '2026-06-09', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('22222222-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('22222222-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false, '00000000-0000-0000-0000-00000000b007');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000009'),
  'fully_filled',
  'main-only show (understudy_slots NULL) reaches fully_filled when the main slots are confirmed'
);

SELECT * FROM finish();
ROLLBACK;
