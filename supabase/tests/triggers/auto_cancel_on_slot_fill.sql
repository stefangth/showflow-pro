-- Tests for public.auto_cancel_on_slot_fill() trigger
-- (defined in 20260514250000_slot_fill_auto_cancel.sql)
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-ac00-0001-…  admin user (for fixtures)
--   bbbbbbbb-ac00-000N-…  artists 1-6
--   cccccccc-ac00-0001-…  show (theatre/musical — configured)
--   dddddddd-ac00-0001-…  show_date
--   eeeeeeee-ac00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre":{"musical":{"main_cast":2,"understudies":1}}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.artists (id, name) VALUES
  ('bbbbbbbb-ac00-0001-0000-000000000000', 'AC Artist 1'),
  ('bbbbbbbb-ac00-0002-0000-000000000000', 'AC Artist 2'),
  ('bbbbbbbb-ac00-0003-0000-000000000000', 'AC Artist 3'),
  ('bbbbbbbb-ac00-0004-0000-000000000000', 'AC Artist 4'),
  ('bbbbbbbb-ac00-0005-0000-000000000000', 'AC Artist 5'),
  ('bbbbbbbb-ac00-0006-0000-000000000000', 'AC Artist 6');

INSERT INTO public.shows (id, title, program, sub_program)
VALUES ('cccccccc-ac00-0001-0000-000000000000', 'AC Test Show', 'theatre', 'musical');

INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0001-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-01', '19:00'::time);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: When main slot fills, remaining suggested bookings are cancelled
--         with reason 'slot_filled'
-- ────────────────────────────────────────────────────────────────────────────
-- Start: 3 suggested main-cast bookings (capacity = 2).
-- Confirm artist 1 → triggers; confirm artist 2 → fills slot → cancels artist 3.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-ac00-0001-0000-000000000000', 'dddddddd-ac00-0001-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0002-0000-000000000000', 'dddddddd-ac00-0001-0000-000000000000', 'bbbbbbbb-ac00-0002-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0003-0000-000000000000', 'dddddddd-ac00-0001-0000-000000000000', 'bbbbbbbb-ac00-0003-0000-000000000000', 'suggested', false);

-- Confirm first artist (slot not yet full, no auto-cancel)
UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0001-0000-000000000000';
-- Confirm second artist (slot now full: 2 of 2 confirmed main)
UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0002-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ac00-0003-0000-000000000000'),
  'cancelled',
  'test 1: remaining suggested main booking cancelled when slot fills'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: Cancelled bookings get cancelled_at set (not null)
-- ────────────────────────────────────────────────────────────────────────────
SELECT isnt(
  (SELECT cancelled_at FROM public.bookings WHERE id = 'eeeeeeee-ac00-0003-0000-000000000000'),
  NULL,
  'test 2: cancelled booking has cancelled_at set'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: Higher offer_tier bookings get reason 'tier_superseded'
-- ────────────────────────────────────────────────────────────────────────────
-- Use a fresh show_date for isolation.
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0002-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-02', '19:00'::time);

-- tier 1 bookings get confirmed (fill slot), tier 2 booking should be 'tier_superseded'
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, offer_tier) VALUES
  ('eeeeeeee-ac00-0004-0000-000000000000', 'dddddddd-ac00-0002-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'suggested', false, 1),
  ('eeeeeeee-ac00-0005-0000-000000000000', 'dddddddd-ac00-0002-0000-000000000000', 'bbbbbbbb-ac00-0002-0000-000000000000', 'suggested', false, 1),
  ('eeeeeeee-ac00-0006-0000-000000000000', 'dddddddd-ac00-0002-0000-000000000000', 'bbbbbbbb-ac00-0003-0000-000000000000', 'suggested', false, 2);

UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0004-0000-000000000000';
UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0005-0000-000000000000';

SELECT is(
  (SELECT cancellation_reason FROM public.bookings WHERE id = 'eeeeeeee-ac00-0006-0000-000000000000'),
  'tier_superseded',
  'test 3: booking with higher offer_tier cancelled with reason tier_superseded'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: Bookings with NULL offer_tier get reason 'slot_filled'
-- ────────────────────────────────────────────────────────────────────────────
-- Re-use the same show_date, clean up existing bookings first for isolation.
-- artist 3 was already cancelled. Check from test 1's date: artist 3 had NULL offer_tier.
SELECT is(
  (SELECT cancellation_reason FROM public.bookings WHERE id = 'eeeeeeee-ac00-0003-0000-000000000000'),
  'slot_filled',
  'test 4: booking with NULL offer_tier gets reason slot_filled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: Main-cast fill does NOT cancel understudy bookings
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0003-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-03', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-ac00-0007-0000-000000000000', 'dddddddd-ac00-0003-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0008-0000-000000000000', 'dddddddd-ac00-0003-0000-000000000000', 'bbbbbbbb-ac00-0002-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0009-0000-000000000000', 'dddddddd-ac00-0003-0000-000000000000', 'bbbbbbbb-ac00-0004-0000-000000000000', 'suggested', true);

UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0007-0000-000000000000';
UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0008-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ac00-0009-0000-000000000000'),
  'suggested',
  'test 5: main-cast fill does NOT cancel understudy bookings'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6: Understudy fill does NOT cancel main-cast bookings
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0004-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-04', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-ac00-0010-0000-000000000000', 'dddddddd-ac00-0004-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0011-0000-000000000000', 'dddddddd-ac00-0004-0000-000000000000', 'bbbbbbbb-ac00-0004-0000-000000000000', 'suggested', true),
  ('eeeeeeee-ac00-0012-0000-000000000000', 'dddddddd-ac00-0004-0000-000000000000', 'bbbbbbbb-ac00-0005-0000-000000000000', 'suggested', true);

-- Confirm understudy (fills 1 of 1 understudy slots)
UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0011-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ac00-0010-0000-000000000000'),
  'suggested',
  'test 6: understudy fill does NOT cancel main-cast bookings'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7: confirmed bookings are not themselves cancelled by the trigger
-- ────────────────────────────────────────────────────────────────────────────
-- The two confirmed artists from test 5 should still be confirmed.
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE show_date_id = 'dddddddd-ac00-0003-0000-000000000000'
     AND status = 'confirmed'),
  2,
  'test 7: confirmed bookings are not themselves cancelled by the trigger'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 8: Trigger does NOT fire on INSERT (only on UPDATE)
-- ────────────────────────────────────────────────────────────────────────────
-- Insert a booking directly as 'confirmed' — should not cancel other bookings.
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0005-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-05', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-ac00-0013-0000-000000000000', 'dddddddd-ac00-0005-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0014-0000-000000000000', 'dddddddd-ac00-0005-0000-000000000000', 'bbbbbbbb-ac00-0002-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0015-0000-000000000000', 'dddddddd-ac00-0005-0000-000000000000', 'bbbbbbbb-ac00-0003-0000-000000000000', 'confirmed', false);

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ac00-0013-0000-000000000000'),
  'suggested',
  'test 8: trigger does NOT fire on INSERT — suggested booking unchanged'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 9: When slot is not yet full, no cancellation happens
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0006-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-06', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-ac00-0016-0000-000000000000', 'dddddddd-ac00-0006-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0017-0000-000000000000', 'dddddddd-ac00-0006-0000-000000000000', 'bbbbbbbb-ac00-0002-0000-000000000000', 'suggested', false),
  ('eeeeeeee-ac00-0018-0000-000000000000', 'dddddddd-ac00-0006-0000-000000000000', 'bbbbbbbb-ac00-0003-0000-000000000000', 'suggested', false);

-- Only confirm ONE artist (need 2 for main_cast), slot not full
UPDATE public.bookings SET status = 'confirmed' WHERE id = 'eeeeeeee-ac00-0016-0000-000000000000';

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE show_date_id = 'dddddddd-ac00-0006-0000-000000000000'
     AND status = 'suggested'),
  2,
  'test 9: slot not full — no suggested bookings cancelled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 10: Idempotency — second UPDATE to confirmed on an already-confirmed
--          booking (OLD.status = confirmed) does nothing
-- ────────────────────────────────────────────────────────────────────────────
-- Use the date from test 1 where 2 are confirmed and 1 is already cancelled.
-- A no-op update on an already-confirmed booking should not alter others.
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-ac00-0007-0000-000000000000', 'cccccccc-ac00-0001-0000-000000000000', '2099-06-07', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-ac00-0019-0000-000000000000', 'dddddddd-ac00-0007-0000-000000000000', 'bbbbbbbb-ac00-0001-0000-000000000000', 'confirmed', false),
  ('eeeeeeee-ac00-0020-0000-000000000000', 'dddddddd-ac00-0007-0000-000000000000', 'bbbbbbbb-ac00-0002-0000-000000000000', 'confirmed', false),
  ('eeeeeeee-ac00-0021-0000-000000000000', 'dddddddd-ac00-0007-0000-000000000000', 'bbbbbbbb-ac00-0003-0000-000000000000', 'suggested', false);

-- Re-confirm an already-confirmed booking — trigger guard: OLD.status = 'confirmed' → RETURN NULL
UPDATE public.bookings SET notes = 'idempotency check' WHERE id = 'eeeeeeee-ac00-0019-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ac00-0021-0000-000000000000'),
  'suggested',
  'test 10: idempotent — UPDATE on non-status column does not trigger cancellation'
);

SELECT * FROM finish();
ROLLBACK;
