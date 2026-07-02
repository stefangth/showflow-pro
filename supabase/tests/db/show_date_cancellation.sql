-- Tests for the Airtable-driven date-cancellation DB layer
-- (migration 20260620130000_show_date_cancellation.sql):
--   * show_dates.cancellation_reason column exists
--   * cascade_cancel_bookings_on_date_cancel releases the date's bookings,
--     stamping cancellation_reason = 'date_cancelled'
--   * the understudy is NOT promoted onto the dead date (guard via the
--     app.cancelling_show_date GUC)
--   * the cancelled date stays cancelled across a later booking write
--   * a released artist keeps SELECT access to the cancelled date and to their
--     own cancelled booking (existing policies already permit this)
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-0c00-000N-…  auth users (admin, artist A)
--   bbbbbbbb-0c00-000N-…  artists A (confirmed main), B (soft_booked us), C (suggested)
--   cccccccc-0c00-0001-…  show (theatre/musical — 1 main + 1 understudy slot)
--   dddddddd-0c00-0001-…  show_date under cancellation
--   eeeeeeee-0c00-000N-…  bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures (as postgres superuser).
-- session_replication_role = replica disables FK/auth triggers so we can insert
-- minimal auth.users rows; they still land in the transaction snapshot for any
-- FK checks that run after the role is reset to DEFAULT.
-- ────────────────────────────────────────────────────────────────────────────
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0c00-0001-0000-000000000000', 'authenticated', 'authenticated', 'sdc-admin@test.com',   now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-0c00-0003-0000-000000000000', 'authenticated', 'authenticated', 'sdc-artista@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());
SET session_replication_role = DEFAULT;

-- Org-scoped role-gating: mirror roles as bootstrap-org memberships. An admin is
-- required for the booking_ready_to_confirm fallback (no show_assignments here),
-- though the cancellation cascade should suppress that path entirely.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-0c00-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-0c00-0003-0000-000000000000','artist');

-- Artist A is the confirmed main (has a user_id so the RLS read assertions apply);
-- B is the soft_booked understudy; C is a suggested main.
INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('bbbbbbbb-0c00-0001-0000-000000000000', 'SDC Artist A', 'aaaaaaaa-0c00-0003-0000-000000000000', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0c00-0002-0000-000000000000', 'SDC Artist B', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-0c00-0003-0000-000000000000', 'SDC Artist C', NULL, '00000000-0000-0000-0000-00000000b007');

-- Slot capacity: 1 main + 1 understudy (so an understudy WOULD be promotable if
-- the guard were absent).
INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id)
VALUES ('cccccccc-0c00-0001-0000-000000000000', 'theatre', 'musical', 1, 1, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-0c00-0001-0000-000000000000', 'cccccccc-0c00-0001-0000-000000000000', '2099-09-01', '19:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-0c00-0001-0000-000000000000', 'dddddddd-0c00-0001-0000-000000000000', 'bbbbbbbb-0c00-0001-0000-000000000000', 'confirmed',   false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0c00-0002-0000-000000000000', 'dddddddd-0c00-0001-0000-000000000000', 'bbbbbbbb-0c00-0002-0000-000000000000', 'soft_booked', true,  '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-0c00-0003-0000-000000000000', 'dddddddd-0c00-0001-0000-000000000000', 'bbbbbbbb-0c00-0003-0000-000000000000', 'suggested',   false, '00000000-0000-0000-0000-00000000b007');

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Column exists
-- ────────────────────────────────────────────────────────────────────────────
SELECT has_column('public', 'show_dates', 'cancellation_reason',
  'show_dates.cancellation_reason column exists');

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger the cascade: cancel the whole date.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.show_dates SET status = 'cancelled'
WHERE id = 'dddddddd-0c00-0001-0000-000000000000';

-- 2-4. Each of the three bookings is now cancelled.
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0c00-0001-0000-000000000000'),
  'cancelled',
  'confirmed main booking (artist A) released to cancelled');

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0c00-0002-0000-000000000000'),
  'cancelled',
  'soft_booked understudy (artist B) released to cancelled');

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = 'eeeeeeee-0c00-0003-0000-000000000000'),
  'cancelled',
  'suggested booking (artist C) released to cancelled');

-- 5. All three carry cancellation_reason = 'date_cancelled'.
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE show_date_id = 'dddddddd-0c00-0001-0000-000000000000'
     AND status = 'cancelled'
     AND cancellation_reason = 'date_cancelled'),
  3,
  'all 3 released bookings stamped cancellation_reason = date_cancelled');

-- 6. The understudy (B) was NOT promoted — still cancelled and still flagged as an
--    understudy (promotion would have set status=confirmed, is_understudy=false).
SELECT ok(
  (SELECT status::text = 'cancelled' AND is_understudy = true
   FROM public.bookings WHERE id = 'eeeeeeee-0c00-0002-0000-000000000000'),
  'understudy (artist B) was NOT promoted onto the cancelled date');

-- 7. The date itself is cancelled.
SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-0c00-0001-0000-000000000000'),
  'cancelled',
  'show_date status is cancelled after cascade');

-- 8. A released (cancelled) booking cannot be re-confirmed: the
--    enforce_booking_transition guard independently rejects cancelled → confirmed
--    (SQLSTATE 23514) before compute_show_date_status ever runs, so the date
--    stays cancelled. (Even setting that aside, compute_show_date_status
--    short-circuits on a cancelled date.)
SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'confirmed'
    WHERE id = 'eeeeeeee-0c00-0001-0000-000000000000'$$,
  '23514',
  null,
  're-confirming a released booking is rejected by the transition guard');

SELECT is(
  (SELECT status::text FROM public.show_dates WHERE id = 'dddddddd-0c00-0001-0000-000000000000'),
  'cancelled',
  'subsequent booking write does not un-cancel the date');

-- ────────────────────────────────────────────────────────────────────────────
-- RLS: a released artist keeps read access.
-- Acting AS artist A's auth user (role authenticated).
-- ────────────────────────────────────────────────────────────────────────────

-- 9. Artist A can still SELECT the cancelled show_date row.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0c00-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.show_dates
   WHERE id = 'dddddddd-0c00-0001-0000-000000000000'),
  1,
  'released artist A can still SELECT the cancelled show_date');

RESET ROLE;

-- 10. Artist A can still SELECT their own cancelled booking.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0c00-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-0c00-0001-0000-000000000000'),
  1,
  'released artist A can still SELECT their own cancelled booking');

RESET ROLE;

-- 11. INSERT branch: a show_date inserted already-cancelled fires the cascade harmlessly
--     (no bookings yet). Locks the NEW-only WHEN + body guard for the INSERT path, which a
--     combined INSERT/UPDATE trigger requires (OLD/TG_OP are illegal in the WHEN clause).
SELECT lives_ok($$
  INSERT INTO public.show_dates (id, show_id, date, session_1, status, org_id)
  VALUES ('dddddddd-0c00-0002-0000-000000000000', 'cccccccc-0c00-0001-0000-000000000000',
          '2099-09-02', '19:00'::time, 'cancelled', '00000000-0000-0000-0000-00000000b007')
$$, 'inserting an already-cancelled show_date fires the cascade without error');

SELECT * FROM finish();
ROLLBACK;
