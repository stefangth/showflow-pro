-- Tests for public.expire_soft_bookings()
-- (defined in 20260514210000_expire_soft_bookings_fn.sql)
--
-- The function performs a single set-based UPDATE:
--   UPDATE bookings
--   SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'offer_expired'
--   WHERE status IN ('suggested', 'soft_booked')
--     AND offer_expires_at IS NOT NULL
--     AND offer_expires_at < now();
--
-- So a row is expired iff: status is suggested OR soft_booked, AND offer_expires_at
-- is non-NULL and strictly in the past. Confirmed / future-expiry / NULL-expiry rows
-- are untouched. The function itself sets cancelled_at + cancellation_reason; the
-- bookings update_updated_at_column() BEFORE UPDATE trigger advances updated_at on any
-- row the UPDATE touches.
--
-- UUID legend (all test-only, rolled back at end):
--   cccccccc-ed00-0001-…  show (theatre/musical)
--   dddddddd-ed00-0001-…  show_date
--   bbbbbbbb-ed00-000N-…  artists 1-5
--   eeeeeeee-ed00-000N-…  bookings under test

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures. session_replication_role = replica disables FK / status
-- recompute triggers so we can seed rows in arbitrary states without the
-- booking_status trigger or auto-cancel trigger interfering.
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('cccccccc-ed00-0001-0000-000000000000', 'theatre', 'musical', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-ed00-0001-0000-000000000000', 'cccccccc-ed00-0001-0000-000000000000', '2099-07-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.artists (id, name, org_id) VALUES
  ('bbbbbbbb-ed00-0001-0000-000000000000', 'ED Artist 1', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-ed00-0002-0000-000000000000', 'ED Artist 2', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-ed00-0003-0000-000000000000', 'ED Artist 3', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-ed00-0004-0000-000000000000', 'ED Artist 4', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-ed00-0005-0000-000000000000', 'ED Artist 5', '00000000-0000-0000-0000-00000000b007');

-- Booking 1: suggested + PAST expiry            → should expire
-- Booking 2: soft_booked + PAST expiry          → should expire
-- Booking 3: suggested + FUTURE expiry          → untouched
-- Booking 4: suggested + NULL expiry            → untouched
-- Booking 5: confirmed + PAST expiry            → untouched (status not in set)
-- Seed updated_at deliberately in the past so we can assert it advances on
-- changed rows and is unchanged on untouched rows.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, offer_expires_at, updated_at, org_id) VALUES
  ('eeeeeeee-ed00-0001-0000-000000000000', 'dddddddd-ed00-0001-0000-000000000000', 'bbbbbbbb-ed00-0001-0000-000000000000', 'suggested',   false, now() - interval '1 hour', now() - interval '2 days', '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-ed00-0002-0000-000000000000', 'dddddddd-ed00-0001-0000-000000000000', 'bbbbbbbb-ed00-0002-0000-000000000000', 'soft_booked', false, now() - interval '1 hour', now() - interval '2 days', '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-ed00-0003-0000-000000000000', 'dddddddd-ed00-0001-0000-000000000000', 'bbbbbbbb-ed00-0003-0000-000000000000', 'suggested',   false, now() + interval '1 day',  now() - interval '2 days', '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-ed00-0004-0000-000000000000', 'dddddddd-ed00-0001-0000-000000000000', 'bbbbbbbb-ed00-0004-0000-000000000000', 'suggested',   false, NULL,                       now() - interval '2 days', '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-ed00-0005-0000-000000000000', 'dddddddd-ed00-0001-0000-000000000000', 'bbbbbbbb-ed00-0005-0000-000000000000', 'confirmed',   false, now() - interval '1 hour', now() - interval '2 days', '00000000-0000-0000-0000-00000000b007');

SET session_replication_role = DEFAULT;

-- Run the reconciliation.
SELECT lives_ok(
  $$ SELECT public.expire_soft_bookings() $$,
  'expire_soft_bookings() runs without error'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1 + 2: suggested with past expiry → cancelled with reason offer_expired
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text || '|' || COALESCE(cancellation_reason, '') || '|' || (cancelled_at IS NOT NULL)::text
   FROM public.bookings WHERE id = 'eeeeeeee-ed00-0001-0000-000000000000'),
  'cancelled|offer_expired|true',
  'suggested + past expiry → cancelled, reason offer_expired, cancelled_at set'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: soft_booked with past expiry is ALSO expired (status set covers both)
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text || '|' || COALESCE(cancellation_reason, '')
   FROM public.bookings WHERE id = 'eeeeeeee-ed00-0002-0000-000000000000'),
  'cancelled|offer_expired',
  'soft_booked + past expiry → cancelled with reason offer_expired'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: future expiry untouched
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ed00-0003-0000-000000000000'),
  'suggested',
  'suggested + future expiry → untouched'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: NULL expiry untouched
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ed00-0004-0000-000000000000'),
  'suggested',
  'suggested + NULL expiry → untouched'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6: confirmed never cancelled (status not in {suggested, soft_booked})
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-ed00-0005-0000-000000000000'),
  'confirmed',
  'confirmed + past expiry → never cancelled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7: updated_at advanced on a changed row (BEFORE UPDATE timestamp trigger)
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT updated_at FROM public.bookings WHERE id = 'eeeeeeee-ed00-0001-0000-000000000000')
    > (now() - interval '1 day'),
  'updated_at advanced on an expired (changed) row'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 8: updated_at NOT advanced on an untouched row (UPDATE never matched it)
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT updated_at FROM public.bookings WHERE id = 'eeeeeeee-ed00-0004-0000-000000000000')
    < (now() - interval '1 day'),
  'updated_at unchanged on an untouched row (NULL expiry)'
);

SELECT * FROM finish();
ROLLBACK;
