-- Tests for public.promote_understudy_on_cancellation() trigger
-- (latest definition: 20260702120003_understudy_promotion_require_acceptance.sql — M4,
--  which builds on the cancelling_show_date guard added in
--  20260620130000_show_date_cancellation.sql)
--
-- M4 behavior asserted here:
--   * only ACCEPTED understudies (status soft_booked) are promoted; a suggested
--     (unaccepted) understudy is never marked as a hold without consent (tests 3/3b/3c);
--   * an accepted understudy who BLOCKED the date is skipped (tests 11/11b);
--   * an accepted understudy with no block on the date is still promoted (test 12).
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-0d00-0001-…  auth user (for artist profiles)
--   bbbbbbbb-0d00-000N-…  artists 1-6
--   cccccccc-0d00-0001-…  show (theatre/musical — configured)
--   dddddddd-0d00-000N-…  show_dates (one per test group)
--   eeeeeeee-0d00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

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
INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('bbbbbbbb-0d00-0001-0000-000000000000', 'UP Artist 1', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0d00-0002-0000-000000000000', 'UP Artist 2', 'aaaaaaaa-0d00-0002-0000-000000000000', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0d00-0003-0000-000000000000', 'UP Artist 3', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0d00-0004-0000-000000000000', 'UP Artist 4', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0d00-0005-0000-000000000000', 'UP Artist 5', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0d00-0006-0000-000000000000', 'UP Artist 6', NULL, '00000000-0000-0000-0000-00000000b007');

-- Slot capacity: 1 main + 1 understudy, set directly on the shows row
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-0d00-0001-0000-000000000000', 'theatre', 'musical', 1, 1, '00000000-0000-0000-0000-00000000b007');

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: Confirmed main-cast cancelled → soft_booked understudy promoted
--         to confirmed with is_understudy = false
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0001-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0001-0000-000000000000', 'dddddddd-0d00-0001-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0002-0000-000000000000', 'dddddddd-0d00-0001-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true, '00000000-0000-0000-0000-00000000b007');

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
-- Test 3 (M4): Confirmed main-cast cancelled with ONLY a suggested (unaccepted)
--         understudy available → the understudy is NOT promoted. M4 requires prior
--         acceptance (status soft_booked) before promotion; a suggested understudy
--         has not consented and must stay a plain offer.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0002-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-02', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0003-0000-000000000000', 'dddddddd-0d00-0002-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0004-0000-000000000000', 'dddddddd-0d00-0002-0000-000000000000', 'bbbbbbbb-0d00-0003-0000-000000000000', 'suggested', true, '00000000-0000-0000-0000-00000000b007');

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0003-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0004-0000-000000000000'),
  'suggested',
  'test 3 (M4): a suggested (unaccepted) understudy is NOT promoted — no consent-free hold'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3b (M4): the suggested understudy still has no confirmed_at (unchanged;
--          it was never touched).
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT confirmed_at FROM public.bookings WHERE id = 'eeeeeeee-0d00-0004-0000-000000000000'),
  NULL,
  'test 3b (M4): unaccepted understudy left untouched → confirmed_at null'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3c (M4): NO booking_ready_to_confirm notification is written, because a
--          suggested understudy is no longer promoted to soft_booked.
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE related_entity_id = 'eeeeeeee-0d00-0004-0000-000000000000'
      AND type = 'booking_ready_to_confirm'
  ),
  'test 3c (M4): no ready-to-confirm notification when the only understudy is unaccepted'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: When both soft_booked and suggested understudies exist,
--         soft_booked is preferred
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0003-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-03', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, created_at, org_id) VALUES
  ('eeeeeeee-0d00-0005-0000-000000000000', 'dddddddd-0d00-0003-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed',  false, now(), '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0006-0000-000000000000', 'dddddddd-0d00-0003-0000-000000000000', 'bbbbbbbb-0d00-0004-0000-000000000000', 'suggested',  true,  now() - interval '1 hour', '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0007-0000-000000000000', 'dddddddd-0d00-0003-0000-000000000000', 'bbbbbbbb-0d00-0005-0000-000000000000', 'soft_booked', true,  now(), '00000000-0000-0000-0000-00000000b007');

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
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0004-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-04', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, created_at, org_id) VALUES
  ('eeeeeeee-0d00-0008-0000-000000000000', 'dddddddd-0d00-0004-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed',  false, now(), '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0009-0000-000000000000', 'dddddddd-0d00-0004-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true,  now() - interval '2 hours', '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0010-0000-000000000000', 'dddddddd-0d00-0004-0000-000000000000', 'bbbbbbbb-0d00-0003-0000-000000000000', 'soft_booked', true,  now() - interval '1 hour', '00000000-0000-0000-0000-00000000b007');

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
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0005-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-05', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0011-0000-000000000000', 'dddddddd-0d00-0005-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'soft_booked', false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0012-0000-000000000000', 'dddddddd-0d00-0005-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true, '00000000-0000-0000-0000-00000000b007');

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
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0006-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-06', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0013-0000-000000000000', 'dddddddd-0d00-0006-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', true, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0014-0000-000000000000', 'dddddddd-0d00-0006-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true, '00000000-0000-0000-0000-00000000b007');

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0013-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0014-0000-000000000000'),
  'soft_booked',
  'test 8: trigger does NOT fire when cancelled booking was an understudy'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 9: No understudy available → no error, other bookings unchanged
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0007-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-07', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0015-0000-000000000000', 'dddddddd-0d00-0007-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed', false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0016-0000-000000000000', 'dddddddd-0d00-0007-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'suggested', false, '00000000-0000-0000-0000-00000000b007');

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
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0008-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-08', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0017-0000-000000000000', 'dddddddd-0d00-0008-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'cancelled', false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0018-0000-000000000000', 'dddddddd-0d00-0008-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true, '00000000-0000-0000-0000-00000000b007');

-- Inserted directly as cancelled — trigger should not have fired
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0018-0000-000000000000'),
  'soft_booked',
  'test 10: trigger does NOT fire on INSERT — understudy not promoted on direct cancel insert'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 11 (M4): an ACCEPTED (soft_booked) understudy who BLOCKED the date is
--         skipped — the block was declared after being offered, so promotion must
--         not force them onto a date they can't work.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0009-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-09', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0019-0000-000000000000', 'dddddddd-0d00-0009-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed',   false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0020-0000-000000000000', 'dddddddd-0d00-0009-0000-000000000000', 'bbbbbbbb-0d00-0002-0000-000000000000', 'soft_booked', true,  '00000000-0000-0000-0000-00000000b007');

-- Artist 2 (the understudy) blocks 2099-07-09.
-- Bypass enforce_blocked_date_no_active_booking (M3): this fixture intentionally
-- creates a block on a date where the artist already has an active (soft_booked)
-- booking, to exercise the promotion trigger's own blocked-date skip.
SET session_replication_role = replica;
INSERT INTO public.blocked_dates (artist_id, date, org_id)
VALUES ('bbbbbbbb-0d00-0002-0000-000000000000', '2099-07-09', '00000000-0000-0000-0000-00000000b007');
SET session_replication_role = DEFAULT;

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0019-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0020-0000-000000000000'),
  'soft_booked',
  'test 11 (M4): an accepted understudy who blocked the date is NOT promoted'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 11b (M4): and no understudy_promoted audit row is written for the blocked
--         understudy's booking.
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.booking_audit_log
    WHERE booking_id = 'eeeeeeee-0d00-0020-0000-000000000000'
      AND action = 'understudy_promoted'
  ),
  'test 11b (M4): no promotion audit row for a blocked understudy'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 12 (M4): an accepted (soft_booked) understudy with NO block on the date is
--         still promoted to confirmed (the blocked_dates guard is scoped to the
--         exact artist+date, not a blanket skip).
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0d00-0010-0000-000000000000', 'cccccccc-0d00-0001-0000-000000000000', '2099-07-10', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0d00-0021-0000-000000000000', 'dddddddd-0d00-0010-0000-000000000000', 'bbbbbbbb-0d00-0001-0000-000000000000', 'confirmed',   false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0d00-0022-0000-000000000000', 'dddddddd-0d00-0010-0000-000000000000', 'bbbbbbbb-0d00-0004-0000-000000000000', 'soft_booked', true,  '00000000-0000-0000-0000-00000000b007');

-- Artist 4 has a block on a DIFFERENT date — must not affect this promotion.
INSERT INTO public.blocked_dates (artist_id, date, org_id)
VALUES ('bbbbbbbb-0d00-0004-0000-000000000000', '2099-12-31', '00000000-0000-0000-0000-00000000b007');

UPDATE public.bookings SET status = 'cancelled' WHERE id = 'eeeeeeee-0d00-0021-0000-000000000000';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0d00-0022-0000-000000000000'),
  'confirmed',
  'test 12 (M4): an accepted understudy with no block on the date is still promoted'
);

SELECT * FROM finish();
ROLLBACK;
