-- Tests for the recompute-cascade triggers and the updated_at timestamp trigger.
--
-- Objects under test:
--   1. sync_show_dates_on_settings_update_trigger  (app_settings AFTER UPDATE)
--        → sync_show_dates_on_settings_update(): when NEW.key = 'sub_program_slots_defaults',
--          recomputes EVERY show_date via compute_show_date_status().
--          (source: 20260514000000_slots_from_settings.sql)
--   2. sync_show_dates_on_show_update_trigger      (shows AFTER UPDATE OF program, sub_program)
--        → sync_show_dates_on_show_update(): recomputes all show_dates for that show.
--          (source: 20260514000000_slots_from_settings.sql; trigger now fires on
--           program/sub_program columns, not the removed slots_per_date)
--   3. update_updated_at_column()                  (shows BEFORE UPDATE, among others)
--        → sets NEW.updated_at = now() on every UPDATE.
--          (source: 20260416115633_…sql)
--
-- compute_show_date_status reads main_cast/understudies from
-- app_settings.sub_program_slots_defaults[program][sub_program]; fully_filled requires
-- confirmed_main >= main_cap AND confirmed_us >= us_cap.
--
-- UUID legend (all test-only, rolled back at end):
--   cccccccc-rc00-000N-…  shows
--   dddddddd-rc00-000N-…  show_dates
--   bbbbbbbb-rc00-000N-…  artists
--   eeeeeeee-rc00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

-- Start with capacity main_cast=1, understudies=0 for theatre/musical so that a
-- single confirmed main booking reaches 'fully_filled'.
INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Configured show used for the settings-cascade test.
INSERT INTO public.shows (id, program, sub_program)
VALUES ('cccccccc-rc00-0001-0000-000000000000', 'theatre', 'musical');

-- A second show whose program/sub_program we will flip for the show-cascade test.
-- It starts as theatre/comedy (UNCONFIGURED in settings → cannot reach fully_filled),
-- then is changed to theatre/musical (CONFIGURED with cap 1) → should flip to fully_filled.
INSERT INTO public.shows (id, program, sub_program)
VALUES ('cccccccc-rc00-0002-0000-000000000000', 'theatre', 'comedy');

INSERT INTO public.artists (id, name) VALUES
  ('bbbbbbbb-rc00-0001-0000-000000000000', 'RC Artist 1'),
  ('bbbbbbbb-rc00-0002-0000-000000000000', 'RC Artist 2');

-- show_date for show 1 with ONE confirmed main booking. With cap main_cast=1 it is
-- fully_filled (the bookings trigger recomputes on insert).
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-rc00-0001-0000-000000000000', 'cccccccc-rc00-0001-0000-000000000000', '2099-08-01', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('eeeeeeee-rc00-0001-0000-000000000000', 'dddddddd-rc00-0001-0000-000000000000', 'bbbbbbbb-rc00-0001-0000-000000000000', 'confirmed', false);

-- show_date for show 2 with ONE confirmed main booking. Show is theatre/comedy
-- (unconfigured) so status is partially_filled until the show's sub_program flips.
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-rc00-0002-0000-000000000000', 'cccccccc-rc00-0002-0000-000000000000', '2099-08-02', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('eeeeeeee-rc00-0002-0000-000000000000', 'dddddddd-rc00-0002-0000-000000000000', 'bbbbbbbb-rc00-0002-0000-000000000000', 'confirmed', false);

-- Sanity: starting states (not counted in plan, asserted as test 1 / baseline).
SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-rc00-0001-0000-000000000000'),
  'fully_filled',
  'baseline: show 1 date is fully_filled under cap main_cast=1'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: raising the slot capacity recomputes affected show_dates (fully→partial)
-- ────────────────────────────────────────────────────────────────────────────
-- Bump main_cast to 2 → the single confirmed main no longer meets capacity →
-- the app_settings AFTER UPDATE trigger recomputes all dates → partially_filled.
UPDATE public.app_settings
SET value = '{"theatre":{"musical":{"main_cast":2,"understudies":0}}}'::jsonb
WHERE key = 'sub_program_slots_defaults';

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-rc00-0001-0000-000000000000'),
  'partially_filled',
  'raising main_cast to 2 recomputes the date down to partially_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: lowering the slot capacity recomputes back up (partial→fully)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.app_settings
SET value = '{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb
WHERE key = 'sub_program_slots_defaults';

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-rc00-0001-0000-000000000000'),
  'fully_filled',
  'lowering main_cast back to 1 recomputes the date up to fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: updating a show's sub_program recomputes its dates' status
-- ────────────────────────────────────────────────────────────────────────────
-- Flip show 2 from theatre/comedy (unconfigured) to theatre/musical (cap 1).
-- Its date has one confirmed main → should become fully_filled.
UPDATE public.shows
SET sub_program = 'musical'
WHERE id = 'cccccccc-rc00-0002-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-rc00-0002-0000-000000000000'),
  'fully_filled',
  'changing a show sub_program (comedy→musical) recomputes its dates to fully_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: update_updated_at_column() advances shows.updated_at on UPDATE
-- ────────────────────────────────────────────────────────────────────────────
-- Pin a known-old updated_at on show 1, then perform an UPDATE and assert the new
-- value is strictly greater (the BEFORE UPDATE trigger overwrites it with now()).
SET session_replication_role = replica;  -- avoid firing the program/sub_program cascade
UPDATE public.shows
SET updated_at = now() - interval '7 days'
WHERE id = 'cccccccc-rc00-0001-0000-000000000000';
SET session_replication_role = DEFAULT;

-- Capture the pinned value, then do a normal UPDATE that fires the timestamp trigger.
UPDATE public.shows
SET program = 'theatre'  -- same value; still an UPDATE, trigger sets updated_at = now()
WHERE id = 'cccccccc-rc00-0001-0000-000000000000';

SELECT ok(
  (SELECT updated_at FROM public.shows WHERE id = 'cccccccc-rc00-0001-0000-000000000000')
    > (now() - interval '1 day'),
  'update_updated_at_column advanced shows.updated_at to ~now() on UPDATE'
);

SELECT * FROM finish();
ROLLBACK;
