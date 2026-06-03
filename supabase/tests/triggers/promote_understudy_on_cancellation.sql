-- Tests for public.promote_understudy_on_cancellation() trigger
-- (defined in 20260519000000_promote_understudy_on_cancellation.sql)
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-0d00-0001-…  auth user (for artist profiles)
--   bbbbbbbb-0d00-000N-…  artists 1-6
--   cccccccc-0d00-0001-…  show (theatre/musical — configured)
--   dddddddd-0d00-000N-…  show_dates (one per test group)
--   eeeeeeee-0d00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre":{"musical":{"main_cast":1,"understudies":1}}}'::jsonb
)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;

-- Admin user required for the booking_ready_to_confirm fallback notification
-- (no show_assignments exist in this test, so the trigger falls back to admins).
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0d00-0001-0000-000000000000', 'authenticated', 'authenticated', 'up-admin@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-0d00-0002-0000-000000000000', 'authenticated', 'authenticated', 'up-artist2@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());
SET session_replication_role = DEFAULT;


-- Phase 1B: org-scoped role-gating — mirror role as a bootstrap-org membership.
INSERT INTO public.org_memberships (org_id, user_id, role)
VALUES ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-0d00-0001-0000-000000000000','admin');

-- Artist 2 has a user_id so the understudy_promoted notification path is exercised
INSERT INTO public.artists (id, name, user_id) VALUES
  ('bbbbbbbb-0d00-0001-0000-000000000000', 'UP Artist 1', NULL),
  ('bbbbbbbb-0d00-0002-0000-000000000000', 'UP Artist 2', 'aaaaaaaa-0d00-0002-0000-000000000000'),
  ('bbbbbbbb-0d00-0003-0000-000000000000', 'UP Artist 3', NULL),
  ('bbbbbbbb-0d00-0004-0000-000000000000', 'UP Artist 4', NULL),
  ('bbbbbbbb-0d00-0005-0000-000000000000', 'UP Artist 5', NULL),
  ('bbbbbbbb-0d00-0006-0000-000000000000', 'UP Artist 6', NULL);

INSERT INTO public.shows (id, program, sub_program)
VALUES ('cccccccc-0d00-0001-0000-000000000000', 'theatre', 'musical');

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: Confirmed main-cast cancelled → soft_booked understudy promoted
--         to confirmed with is_understudy = false
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0001-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-01', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-0d00-0001-0000-000000000000', 'dddddddd-0d00-0001-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', false),
  ('eeeeeeee-0d00-0002-0000-000000000000', 'dddddddd-0d00-0001-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true);

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0001-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0002-0000-000000000000'),
  'confirmed',
  'test 1: soft_booked understudy promoted to confirmed when main-cast booking cancelled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: Promoted booking has is_understudy = false
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT is_understudy FROM public.bookings WHERE id = 'eeeeeeee-0d00-0002-0000-000000000000'),
  false,
  'test 2: promoted booking has is_understudy = false'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2b: confirmed_at is stamped when soft_booked understudy is promoted
--          to confirmed (re-uses fixture from tests 1 & 2)
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT confirmed_at FROM public.bookings WHERE id = 'eeeeeeee-0d00-0002-0000-000000000000') IS NOT NULL,
  'test 2b: confirmed_at is set when soft_booked understudy is promoted to confirmed'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2c: understudy_promoted notification written to the promoted artist
--          (artist 2 has user_id = aaaaaaaa-0d00-0002; re-uses test 1 fixture)
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = 'aaaaaaaa-0d00-0002-0000-000000000000'
      AND type = 'understudy_promoted'
      AND related_entity_id = 'dddddddd-0d00-0001-0000-000000000000'
  ),
  'test 2c: understudy_promoted notification written to the promoted artist'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: Confirmed main-cast cancelled → suggested understudy promoted
--         to soft_booked with is_understudy = false
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0002-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-02', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-0d00-0003-0000-000000000000', 'dddddddd-0d00-0002-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', false),
  ('eeeeeeee-0d00-0004-0000-000000000000', 'dddddddd-0d00-0002-0000-000000000000', 'bbbbbbbb-0d00-0003-0000-000000000000', 'suggested', true);

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0003-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0004-0000-000000000000'),
  'soft_booked',
  'test 3: suggested understudy promoted to soft_booked when main-cast booking cancelled'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3b: confirmed_at is NOT set when suggested understudy is only promoted
--          to soft_booked (re-uses fixture from test 3)
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT confirmed_at FROM public.bookings WHERE id = 'eeeeeeee-0d00-0004-0000-000000000000'),
  NULL,
  'test 3b: confirmed_at is null when suggested understudy reaches soft_booked (not confirmed)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3c: booking_ready_to_confirm notification written for producers when
--          a suggested understudy is promoted to soft_booked
--          (no show_assignments exist → admin fallback fires)
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notifications
    WHERE related_entity_id = 'eeeeeeee-0d00-0004-0000-000000000000'
      AND type = 'booking_ready_to_confirm'
  ),
  'test 3c: booking_ready_to_confirm notification written when suggested understudy promoted to soft_booked'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: When both soft_booked and suggested understudies exist,
--         soft_booked is preferred
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0003-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-03', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, created_at) VALUES
  ('eeeeeeee-0d00-0005-0000-000000000000', 'dddddddd-0d00-0003-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed',  false, now()),
  ('eeeeeeee-0d00-0006-0000-000000000000', 'dddddddd-0d00-0003-0000-000000000000', 'bbbbbbbb-0d00-0004-0000-000000000000', 'suggested',  true,  now() - interval '1 hour'),
  ('eeeeeeee-0d00-0007-0000-000000000000', 'dddddddd-0d00-0003-0000-000000000000', 'bbbbbbbb-0d00-0005-0000-000000000000', 'soft_booked', true,  now());

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0005-0000-000000000000';

-- soft_booked understudy (0007) should be promoted, not the suggested one (0006)
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0007-0000-000000000000'),
  'confirmed',
  'test 4: soft_booked understudy preferred over suggested when both exist'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4b: suggested understudy (0006) is NOT promoted when a soft_booked
--          understudy (0007) exists — it should remain suggested
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0006-0000-000000000000'),
  'suggested',
  'test 4b: suggested understudy not promoted when a soft_booked understudy exists'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: When multiple soft_booked understudies exist, oldest is picked
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0004-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-04', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, created_at) VALUES
  ('eeeeeeee-0d00-0008-0000-000000000000', 'dddddddd-0d00-0004-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed',  false, now()),
  ('eeeeeeee-0d00-0009-0000-000000000000', 'dddddddd-0d00-0004-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true,  now() - interval '2 hours'),
  ('eeeeeeee-0d00-0010-0000-000000000000', 'dddddddd-0d00-0004-0000-000000000000', 'bbbbbbbb-0d00-0003-0000-000000000000', 'soft_booked', true,  now() - interval '1 hour');

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0008-0000-000000000000';

-- Oldest soft_booked understudy (0009, created 2h ago) should be promoted
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0009-0000-000000000000'),
  'confirmed',
  'test 5: oldest soft_booked understudy is promoted when multiple candidates exist'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6: Promotion appends a row to booking_audit_log
-- ────────────────────────────────────────────────────────────────────────────
-- Re-use test 1's promoted booking (eeeeeeee-0d00-0002)
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.booking_audit_log
    WHERE booking_id = 'eeeeeeee-0d00-0002-0000-000000000000'
      AND action = 'understudy_promoted'
  ),
  'test 6: audit log row written with action understudy_promoted'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6b: notify_booking_transition does NOT write a status_change entry for
--          system-driven promotions (GUC guard suppression)
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = 'eeeeeeee-0d00-0002-0000-000000000000'
     AND action = 'status_change'),
  0,
  'test 6b: notify_booking_transition does NOT write a status_change entry for system-driven promotion'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7: Trigger does NOT fire when a soft_booked (not confirmed) booking
--         is cancelled
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0005-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-05', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-0d00-0011-0000-000000000000', 'dddddddd-0d00-0005-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'soft_booked', false),
  ('eeeeeeee-0d00-0012-0000-000000000000', 'dddddddd-0d00-0005-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true);

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0011-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0012-0000-000000000000'),
  'soft_booked',
  'test 7: trigger does NOT fire when cancelled booking was soft_booked (not confirmed)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 8: Trigger does NOT fire when an understudy (is_understudy = true)
--         booking is cancelled
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0006-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-06', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-0d00-0013-0000-000000000000', 'dddddddd-0d00-0006-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', true),
  ('eeeeeeee-0d00-0014-0000-000000000000', 'dddddddd-0d00-0006-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true);

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0013-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0014-0000-000000000000'),
  'soft_booked',
  'test 8: trigger does NOT fire when cancelled booking was an understudy'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 9: No understudy available → no error, other bookings unchanged
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0007-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-07', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-0d00-0015-0000-000000000000', 'dddddddd-0d00-0007-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', false),
  ('eeeeeeee-0d00-0016-0000-000000000000', 'dddddddd-0d00-0007-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'suggested', false);

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0015-0000-000000000000';

-- The other main-cast suggested booking should be untouched
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0016-0000-000000000000'),
  'suggested',
  'test 9: no understudy available — other bookings unchanged, no error'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 10: Trigger does NOT fire on INSERT (only on UPDATE)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('dddddddd-0d00-0008-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-08', '19:00'::time);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('eeeeeeee-0d00-0017-0000-000000000000', 'dddddddd-0d00-0008-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'cancelled', false),
  ('eeeeeeee-0d00-0018-0000-000000000000', 'dddddddd-0d00-0008-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true);

-- Inserted directly as cancelled — trigger should not have fired
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0018-0000-000000000000'),
  'soft_booked',
  'test 10: trigger does NOT fire on INSERT — understudy not promoted on direct cancel insert'
);

SELECT * FROM finish();
ROLLBACK;
