-- Tests for public.auto_cancel_on_slot_fill() and slot_fill_auto_cancel_trigger.
--
-- The trigger auto-cancels still-open bookings for the same show date and slot
-- type once confirmations fill that slot type's capacity. It also records why
-- a booking lost: a lower-priority tier was superseded, or the slot simply filled.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"trigger-tests": {"auto-cancel": {"main_cast": 2, "understudies": 1}}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.shows (id, title, program, sub_program)
VALUES ('71000000-0000-0000-0000-000000000001', 'Auto Cancel Trigger Show', 'trigger-tests', 'auto-cancel');

INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '2099-02-01', '19:00'::time),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', '2099-02-02', '19:00'::time),
  ('72000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', '2099-02-03', '19:00'::time),
  ('72000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000001', '2099-02-04', '19:00'::time);

INSERT INTO public.artists (id, name) VALUES
  ('73000000-0000-0000-0000-000000000001', 'Auto Cancel Artist 1'),
  ('73000000-0000-0000-0000-000000000002', 'Auto Cancel Artist 2'),
  ('73000000-0000-0000-0000-000000000003', 'Auto Cancel Artist 3'),
  ('73000000-0000-0000-0000-000000000004', 'Auto Cancel Artist 4'),
  ('73000000-0000-0000-0000-000000000005', 'Auto Cancel Artist 5'),
  ('73000000-0000-0000-0000-000000000006', 'Auto Cancel Artist 6'),
  ('73000000-0000-0000-0000-000000000007', 'Auto Cancel Artist 7'),
  ('73000000-0000-0000-0000-000000000008', 'Auto Cancel Artist 8'),
  ('73000000-0000-0000-0000-000000000009', 'Auto Cancel Artist 9'),
  ('73000000-0000-0000-0000-000000000010', 'Auto Cancel Artist 10'),
  ('73000000-0000-0000-0000-000000000011', 'Auto Cancel Artist 11'),
  ('73000000-0000-0000-0000-000000000012', 'Auto Cancel Artist 12'),
  ('73000000-0000-0000-0000-000000000013', 'Auto Cancel Artist 13'),
  ('73000000-0000-0000-0000-000000000014', 'Auto Cancel Artist 14'),
  ('73000000-0000-0000-0000-000000000015', 'Auto Cancel Artist 15'),
  ('73000000-0000-0000-0000-000000000016', 'Auto Cancel Artist 16');

-- ────────────────────────────────────────────────────────────────────────────
-- NULL offer_tier + two confirmations in one statement: open main offers lose
-- because the slot filled, not because a tier was superseded.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, offer_tier) VALUES
  ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'soft_booked', false, NULL),
  ('74000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000002', 'soft_booked', false, NULL),
  ('74000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000003', 'suggested', false, NULL),
  ('74000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000004', 'suggested', true, NULL);

UPDATE public.bookings
SET status = 'confirmed'
WHERE id IN (
  '74000000-0000-0000-0000-000000000001',
  '74000000-0000-0000-0000-000000000002'
);

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE show_date_id = '72000000-0000-0000-0000-000000000001'
     AND is_understudy = false
     AND status = 'confirmed'),
  2,
  'two main-cast confirmations in one update both remain confirmed'
);

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000003'),
  'cancelled',
  'filling main-cast capacity cancels remaining open main-cast bookings'
);

SELECT is(
  (SELECT cancellation_reason FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000003'),
  'slot_filled',
  'NULL offer_tier cancellation uses slot_filled reason'
);

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000004'),
  'suggested',
  'main-cast fill does not cancel understudy bookings'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Higher numbered offer tiers lose to a lower confirmed tier.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, offer_tier) VALUES
  ('74000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000005', 'soft_booked', false, 1),
  ('74000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000006', 'soft_booked', false, 2),
  ('74000000-0000-0000-0000-000000000007', '72000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000007', 'suggested', false, 3),
  ('74000000-0000-0000-0000-000000000008', '72000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000008', 'suggested', false, 1);

UPDATE public.bookings SET status = 'confirmed'
WHERE id IN (
  '74000000-0000-0000-0000-000000000005',
  '74000000-0000-0000-0000-000000000006'
);

SELECT is(
  (SELECT cancellation_reason FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000007'),
  'tier_superseded',
  'higher open tier is cancelled as tier_superseded once lower tier fills the slot'
);

SELECT is(
  (SELECT cancellation_reason FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000008'),
  'slot_filled',
  'same-tier open booking is cancelled as slot_filled rather than tier_superseded'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Understudy capacity is filled independently from main-cast capacity.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, offer_tier) VALUES
  ('74000000-0000-0000-0000-000000000009', '72000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000009', 'soft_booked', true, 1),
  ('74000000-0000-0000-0000-000000000010', '72000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000010', 'suggested', true, 2),
  ('74000000-0000-0000-0000-000000000011', '72000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000011', 'suggested', false, 2);

UPDATE public.bookings SET status = 'confirmed'
WHERE id = '74000000-0000-0000-0000-000000000009';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000010'),
  'cancelled',
  'filling understudy capacity cancels remaining understudy bookings'
);

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '74000000-0000-0000-0000-000000000011'),
  'suggested',
  'understudy fill does not cancel main-cast bookings'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Idempotency: retrying an already-confirmed row must not re-run cancellation.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, offer_tier) VALUES
  ('74000000-0000-0000-0000-000000000012', '72000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000012', 'soft_booked', false, 1),
  ('74000000-0000-0000-0000-000000000013', '72000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000013', 'soft_booked', false, 1),
  ('74000000-0000-0000-0000-000000000014', '72000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000014', 'suggested', false, 2);

UPDATE public.bookings SET status = 'confirmed'
WHERE id IN (
  '74000000-0000-0000-0000-000000000012',
  '74000000-0000-0000-0000-000000000013'
);

CREATE TEMP TABLE auto_cancel_retry_snapshot AS
SELECT id, status, cancellation_reason, cancelled_at
FROM public.bookings
WHERE id = '74000000-0000-0000-0000-000000000014';

UPDATE public.bookings
SET notes = 'retry/no-op update on an already confirmed row'
WHERE id = '74000000-0000-0000-0000-000000000012';

SELECT is(
  (SELECT count(*)::int
   FROM public.bookings b
   JOIN auto_cancel_retry_snapshot s USING (id)
   WHERE b.status = s.status
     AND b.cancellation_reason IS NOT DISTINCT FROM s.cancellation_reason
     AND b.cancelled_at IS NOT DISTINCT FROM s.cancelled_at),
  1,
  'retry update on an already confirmed booking leaves prior auto-cancel result unchanged'
);

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE show_date_id = '72000000-0000-0000-0000-000000000004'
     AND status = 'cancelled'),
  1,
  'retry update does not create additional cancellations'
);

SELECT * FROM finish();
ROLLBACK;
