-- Tests for the recompute-cascade triggers and the updated_at timestamp trigger.
--
-- Objects under test:
--   1. sync_show_dates_on_show_update_trigger  (shows AFTER UPDATE OF program, sub_program,
--                                               main_cast_slots, understudy_slots)
--        → sync_show_dates_on_show_update(): recomputes all show_dates for that show.
--   2. update_updated_at_column()              (shows BEFORE UPDATE)
--        → sets NEW.updated_at = now() on every UPDATE.
--
-- NOTE: sync_show_dates_on_settings_update_trigger (app_settings → recompute) was DROPPED
-- in Phase 1b-DB. Tests 2 and 3 (app_settings cascade) have been removed.
-- compute_show_date_status now reads slots from shows.main_cast_slots / shows.understudy_slots.
--
-- UUID legend (all test-only, rolled back at end):
--   cccccccc-bc00-000N-…  shows
--   dddddddd-bc00-000N-…  show_dates
--   bbbbbbbb-bc00-000N-…  artists
--   eeeeeeee-bc00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

-- Show 1: main_cast_slots=1, understudy_slots=0 → one confirmed main → fully_filled.
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-bc00-0001-0000-000000000000', 'theatre', 'musical', 1, 0, '00000000-0000-0000-0000-00000000b007');

-- Show 2: NULL slots (unconfigured) → cannot reach fully_filled initially.
-- When main_cast_slots/understudy_slots are set, the trigger recomputes its dates.
INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('cccccccc-bc00-0002-0000-000000000000', 'theatre', 'comedy', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.artists (id, name, org_id) VALUES
  ('bbbbbbbb-bc00-0001-0000-000000000000', 'RC Artist 1', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-bc00-0002-0000-000000000000', 'RC Artist 2', '00000000-0000-0000-0000-00000000b007');

-- show_date for show 1 with ONE confirmed main booking. With main_cast_slots=1 it is
-- fully_filled (the bookings trigger recomputes on insert).
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-bc00-0001-0000-000000000000', 'cccccccc-bc00-0001-0000-000000000000', '2099-08-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id)
VALUES ('eeeeeeee-bc00-0001-0000-000000000000', 'dddddddd-bc00-0001-0000-000000000000', 'bbbbbbbb-bc00-0001-0000-000000000000', 'confirmed', false, '00000000-0000-0000-0000-00000000b007');

-- show_date for show 2 with ONE confirmed main booking. Show has NULL slots
-- (unconfigured) → status is partially_filled until slots are configured on shows.
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-bc00-0002-0000-000000000000', 'cccccccc-bc00-0002-0000-000000000000', '2099-08-02', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id)
VALUES ('eeeeeeee-bc00-0002-0000-000000000000', 'dddddddd-bc00-0002-0000-000000000000', 'bbbbbbbb-bc00-0002-0000-000000000000', 'confirmed', false, '00000000-0000-0000-0000-00000000b007');

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1 (baseline): show 1 date is fully_filled under main_cast_slots=1
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-bc00-0001-0000-000000000000'),
  'fully_filled',
  'baseline: show 1 date is fully_filled under main_cast_slots=1'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: updating a show's slot columns recomputes its dates' status
-- ────────────────────────────────────────────────────────────────────────────
-- Raise main_cast_slots on show 1 from 1 → 2. The single confirmed main no longer
-- meets capacity → trigger recomputes → partially_filled.
UPDATE public.shows
SET main_cast_slots = 2
WHERE id = 'cccccccc-bc00-0001-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-bc00-0001-0000-000000000000'),
  'partially_filled',
  'raising main_cast_slots to 2 recomputes the date down to partially_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: update_updated_at_column() advances shows.updated_at on UPDATE
-- ────────────────────────────────────────────────────────────────────────────
-- Pin a known-old updated_at on show 1, then perform an UPDATE and assert the new
-- value is strictly greater (the BEFORE UPDATE trigger overwrites it with now()).
SET session_replication_role = replica;  -- avoid firing the slot-column cascade
UPDATE public.shows
SET updated_at = now() - interval '7 days'
WHERE id = 'cccccccc-bc00-0001-0000-000000000000';
SET session_replication_role = DEFAULT;

-- A normal UPDATE fires the timestamp trigger (setting updated_at = now()).
UPDATE public.shows
SET program = 'theatre'  -- same value; still an UPDATE, trigger sets updated_at = now()
WHERE id = 'cccccccc-bc00-0001-0000-000000000000';

SELECT ok(
  (SELECT updated_at FROM public.shows WHERE id = 'cccccccc-bc00-0001-0000-000000000000')
    > (now() - interval '1 day'),
  'update_updated_at_column advanced shows.updated_at to ~now() on UPDATE'
);

SELECT * FROM finish();
ROLLBACK;
