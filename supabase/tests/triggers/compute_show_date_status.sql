-- Tests for public.compute_show_date_status() and the sync_show_date_status_trigger
-- (defined in 20260514000000_slots_from_settings.sql, patched by 20260514150000_fix_zero_slot_status.sql).
--
-- The function:
--   - reads main_cast / understudies from app_settings.sub_program_slots_defaults[program][sub_program]
--   - counts confirmed bookings on the show_date, split by is_understudy
--   - sets show_dates.status to:
--       'fully_filled'     if confirmed_main >= main_cap AND confirmed_us >= us_cap
--       'partially_filled' if any non-cancelled booking exists
--       'open'             otherwise
--   - never overwrites 'cancelled'
--   - when (program, sub_program) is unconfigured, never reaches 'fully_filled'

BEGIN;

-- pgTAP must be loaded before plan() can be called. Some CLI versions
-- auto-load it; doing it here makes the file portable.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

-- Slot defaults: theatre/musical needs 2 main + 1 understudy
INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre": {"musical": {"main_cast": 2, "understudies": 1}}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Configured show
INSERT INTO public.shows (id, program, sub_program)
VALUES ('11111111-1111-1111-1111-111111111111', 'theatre', 'musical');

-- Unconfigured show (program/sub_program with no entry in settings)
INSERT INTO public.shows (id, program, sub_program)
VALUES ('11111111-1111-1111-1111-111111111112', 'theatre', 'comedy');

-- Four artists for stacking bookings on the same date
INSERT INTO public.artists (id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'Artist 1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'Artist 2'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'Artist 3'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'Artist 4');

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: Configured, no bookings → 'open'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-06-01', '19:00'::time);

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
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026-06-02', '19:00'::time);

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy)
VALUES ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'suggested', false);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000002'),
  'partially_filled',
  'one suggested booking → partially_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: Exact capacity (2 main + 1 understudy confirmed) → 'fully_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '2026-06-03', '19:00'::time);

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy) VALUES
  ('22222222-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', true);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000003'),
  'fully_filled',
  'exact capacity (2 main + 1 understudy) → fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: Main cast met but understudy missing → 'partially_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '2026-06-04', '19:00'::time);

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy) VALUES
  ('22222222-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000004'),
  'partially_filled',
  '2 main + 0 understudy → partially_filled (understudy slot not met)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: Over capacity on main (3 confirmed main, 1 understudy) → 'fully_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '2026-06-05', '19:00'::time);

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy) VALUES
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04', 'confirmed', true);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000005'),
  'fully_filled',
  'over-capacity main (3 of 2) + understudy → fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6: 'cancelled' is never overwritten
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, status)
VALUES ('22222222-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '2026-06-06', '19:00'::time, 'cancelled');

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy) VALUES
  ('22222222-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', true);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000006'),
  'cancelled',
  'cancelled status is never overwritten by the trigger'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7: Unconfigured (program, sub_program) → caps at 'partially_filled'
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111112', '2026-06-07', '19:00'::time);

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy) VALUES
  ('22222222-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'confirmed', true);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000007'),
  'partially_filled',
  'unconfigured (program, sub_program) never reaches fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 8: Cancelled bookings do not count toward thresholds
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('22222222-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '2026-06-08', '19:00'::time);

INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy) VALUES
  ('22222222-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'confirmed', false),
  ('22222222-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'cancelled', false),
  ('22222222-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'cancelled', true);

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = '22222222-0000-0000-0000-000000000008'),
  'partially_filled',
  'cancelled bookings ignored — only 1 confirmed main counts'
);

SELECT * FROM finish();
ROLLBACK;
