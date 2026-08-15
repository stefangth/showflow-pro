-- RLS tests for public.bookings, public.booking_audit_log, and the
-- "Artists can respond to own offers" UPDATE policy.
--
-- Policies under test (source migrations):
--   "Admins and producers can manage bookings"   — 20260416115633
--   "Artists can view own bookings"              — 20260416115633
--   "Artists can respond to own offers"          — 20260514230000
--   "Admins/producers can view audit logs"       — 20260416115633, 20260416115703
--
-- UUID legend (all IDs are test-only, rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist A user
--   aaaaaaaa-aaaa-0004-…  artist B user
--   bbbbbbbb-bbbb-0001-…  artist A profile row
--   bbbbbbbb-bbbb-0002-…  artist B profile row
--   cccccccc-cccc-0001-…  show
--   dddddddd-dddd-0001-…  show_date
--   eeeeeeee-eeee-0001-…  booking: artist A, suggested   (visibility test)
--   eeeeeeee-eeee-0002-…  booking: artist B, suggested   (visibility test)
--   eeeeeeee-eeee-0003-…  booking: artist A, suggested   (update → soft_booked)
--   eeeeeeee-eeee-0004-…  booking: artist A, suggested   (illegal → confirmed)
--   eeeeeeee-eeee-0005-…  booking: artist A, confirmed   (USING blocks update)
--   eeeeeeee-eeee-0006-…  booking: artist A, suggested   (artist B can't update)
--   eeeeeeee-eeee-0007-…  booking: artist A, suggested   (self-confirm under producer_confirmation=false)
--   eeeeeeee-eeee-0008-…  booking: artist A, suggested   (status-only accept still lives_ok)
--   eeeeeeee-eeee-0009-…  booking: artist A, suggested   (artist retarget throws; immutable refs)
--   eeeeeeee-eeee-000a-…  booking: artist A, suggested   (superuser retarget throws; role-independent)
--   ffffffff-ffff-0001-…  booking_audit_log entry
--   aaaaaaaa-aaaa-0005-…  producer user, DIFFERENT org (extend_offer_expiry cross-org test)
--   00000000-…-0000c007   second org (extend_offer_expiry cross-org test)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(22);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup (as postgres superuser)
-- session_replication_role = replica disables FK trigger checks and auth
-- triggers so we can insert minimal rows without real auth.users constraints.
-- The auth.users rows still land in the transaction snapshot and satisfy any
-- FK checks that run AFTER we reset the role back to DEFAULT.
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-artista@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-artistb@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0005-0000-000000000000', 'authenticated', 'authenticated', 'rls-bk-otherorgprod@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- Second org, used only by the extend_offer_expiry cross-org test (org_isolation
-- must block a member of a DIFFERENT org from affecting bootstrap-org b007 rows).
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-00000000c007', 'RLS BK Other Org', 'rls-bk-other-org');


-- Phase 1B: role-gating is now org-scoped (has_org_role). Domain rows below default
-- to the bootstrap org, so mirror the roles as bootstrap-org memberships.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0004-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000c007','aaaaaaaa-aaaa-0005-0000-000000000000','producer');

INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('bbbbbbbb-bbbb-0001-0000-000000000000', 'RLS Artist A', 'aaaaaaaa-aaaa-0003-0000-000000000000', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-bbbb-0002-0000-000000000000', 'RLS Artist B', 'aaaaaaaa-aaaa-0004-0000-000000000000', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('cccccccc-cccc-0001-0000-000000000000', 'theatre', 'musical', '00000000-0000-0000-0000-00000000b007');

-- Distinct show_dates so each artist-A booking below is on its own date — the new
-- bookings_active_artist_date_uniq index allows only one active booking per
-- (show_date, artist). The policy assertions key off booking IDs + roles, not the date.
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('dddddddd-dddd-0001-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-01', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0002-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-02', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0003-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-03', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0004-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-04', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0005-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-05', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0006-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-06', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0007-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-07', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0008-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-08', '20:00'::time, '00000000-0000-0000-0000-00000000b007'),
  ('dddddddd-dddd-0009-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-01-09', '20:00'::time, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-eeee-0001-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0002-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0002-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0003-0000-000000000000', 'dddddddd-dddd-0002-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0004-0000-000000000000', 'dddddddd-dddd-0003-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0005-0000-000000000000', 'dddddddd-dddd-0004-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'confirmed'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0006-0000-000000000000', 'dddddddd-dddd-0005-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0007-0000-000000000000', 'dddddddd-dddd-0006-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0008-0000-000000000000', 'dddddddd-dddd-0007-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0009-0000-000000000000', 'dddddddd-dddd-0008-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-000a-0000-000000000000', 'dddddddd-dddd-0009-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'suggested'::booking_status, false, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.booking_audit_log (id, booking_id, action, old_status, new_status, performed_by, org_id)
VALUES (
  'ffffffff-ffff-0001-0000-000000000000',
  'eeeeeeee-eeee-0001-0000-000000000000',
  'status_change',
  'suggested'::booking_status,
  'soft_booked'::booking_status,
  'aaaaaaaa-aaaa-0001-0000-000000000000',
  '00000000-0000-0000-0000-00000000b007'
);

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Bookings SELECT visibility
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Admin sees any booking (including those belonging to other artists)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'admin sees artist B booking'
);

RESET ROLE;

-- 2. Producer sees any booking
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'producer sees artist A booking'
);

RESET ROLE;

-- 3. Artist A sees own booking
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'artist A sees own booking'
);

RESET ROLE;

-- 4. Artist B cannot see artist A's booking
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  0,
  'artist B cannot see artist A booking'
);

RESET ROLE;

-- 5. Artist cannot insert a booking directly (no INSERT policy for artist role)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id)
    VALUES (
      'dddddddd-dddd-0001-0000-000000000000',
      'bbbbbbbb-bbbb-0001-0000-000000000000',
      'suggested',
      false,
      '00000000-0000-0000-0000-00000000b007'
    )$$,
  null, null,
  'artist cannot insert booking directly'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- booking_audit_log SELECT visibility
-- ────────────────────────────────────────────────────────────────────────────

-- 6. Admin can view audit log
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'admin can view booking_audit_log entry'
);

RESET ROLE;

-- 7. Producer can view audit log
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'producer can view booking_audit_log entry'
);

RESET ROLE;

-- 8. Artist cannot view audit log (no SELECT policy for artist role)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log),
  0,
  'artist sees zero booking_audit_log rows'
);

RESET ROLE;

-- 8b/8c. The Trust Center's "Append-only" claim for this table (no policy
--        anywhere permits altering or deleting a row) is otherwise untested:
--        tests 6-8 above only assert SELECT visibility. Checked as metadata
--        rather than by attempting an UPDATE/DELETE as each role, so a future
--        migration that adds either policy for ANY role fails this test
--        immediately rather than only when someone happens to exercise it.
--        `permissive = 'PERMISSIVE'` excludes the restrictive org_isolation
--        (cmd = 'ALL') policy, which narrows access but never grants it.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'booking_audit_log'
     AND permissive = 'PERMISSIVE' AND cmd IN ('UPDATE', 'ALL')),
  0,
  'booking_audit_log has no permissive UPDATE (or ALL) policy for any role'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'booking_audit_log'
     AND permissive = 'PERMISSIVE' AND cmd IN ('DELETE', 'ALL')),
  0,
  'booking_audit_log has no permissive DELETE (or ALL) policy for any role'
);

-- ────────────────────────────────────────────────────────────────────────────
-- "Artists can respond to own offers" UPDATE policy
-- ────────────────────────────────────────────────────────────────────────────

-- 9. Artist A can accept own suggested offer (→ soft_booked)
--    The notify_booking_transition SECURITY DEFINER trigger fires and writes
--    an audit row + notification for the admin fallback; both succeed because
--    the admin's auth.users row exists in this transaction.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000'),
  'soft_booked',
  'artist A can accept own offer (suggested → soft_booked)'
);

-- 10. Artist A cannot set own offer directly to confirmed. suggested → confirmed
--     is now a legal transition at the enforce_booking_transition guard (auto-
--     confirm acceptance under booking_flow), so the RLS WITH CHECK — which only
--     lets an artist move their own offer to 'soft_booked' | 'cancelled' — is now
--     the layer that blocks the direct jump, raising SQLSTATE 42501. Either way
--     the direct jump to confirmed is blocked.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.bookings SET status = 'confirmed'
    WHERE id = 'eeeeeeee-eeee-0004-0000-000000000000'$$,
  '42501',
  null,
  'artist A cannot set own offer to confirmed (RLS WITH CHECK blocks confirmed)'
);

RESET ROLE;

-- 11. Artist A cannot update own confirmed booking
--     USING requires status = 'suggested'; confirmed booking is invisible to
--     the UPDATE, so 0 rows are affected and no error is raised.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE public.bookings SET status = 'soft_booked'
WHERE id = 'eeeeeeee-eeee-0005-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0005-0000-000000000000'),
  'confirmed',
  'confirmed booking unchanged — USING status=suggested blocked artist A'
);

-- 12. Artist B cannot update artist A's booking (USING artist_id check fails)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE public.bookings SET status = 'soft_booked'
WHERE id = 'eeeeeeee-eeee-0006-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0006-0000-000000000000'),
  'suggested',
  'artist A booking unchanged — USING artist_id check blocked artist B'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Auto-confirm branch: with the org's booking_flow.producer_confirmation = false,
-- an artist accepting their own suggested offer confirms it in one step.
-- Seeded here (as postgres superuser, RLS-bypassing) AFTER test 10 asserted the
-- default-flow deny, so the org had no booking_flow row until this point.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_settings (org_id, key, value)
VALUES ('00000000-0000-0000-0000-00000000b007', 'booking_flow', '{"producer_confirmation":false}'::jsonb);

-- 13. Artist A CAN self-confirm own suggested offer when producer_confirmation is off.
--     The WITH CHECK's confirmed branch passes because get_org_setting resolves the
--     org's booking_flow to producer_confirmation=false. enforce_booking_transition
--     already allows suggested → confirmed.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'confirmed', confirmed_at = now()
    WHERE id = 'eeeeeeee-eeee-0007-0000-000000000000'$$,
  'artist A can self-confirm own offer when producer_confirmation is disabled'
);

RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings
   WHERE id = 'eeeeeeee-eeee-0007-0000-000000000000'),
  'confirmed',
  'offer auto-confirmed by artist (producer_confirmation=false → suggested → confirmed)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- enforce_booking_immutable_refs guard (bookings_retarget_guard migration)
-- show_date_id / artist_id are immutable after creation. These run AFTER the
-- producer_confirmation=false row is seeded (above), so the retarget-throws
-- scenarios prove the guard blocks the hijack even in a self-confirm org where
-- the RLS WITH CHECK would otherwise let an artist reach 'confirmed'.
-- ────────────────────────────────────────────────────────────────────────────

-- 15. A plain status-only accept still succeeds under the guard (no ref change).
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE public.bookings SET status = 'soft_booked'
    WHERE id = 'eeeeeeee-eeee-0008-0000-000000000000'$$,
  'status-only accept still lives_ok; guard only blocks ref changes'
);

RESET ROLE;

-- 16. Artist A retargeting their own offer onto another same-org date while
--     accepting throws check_violation (23514), even though producer_confirmation
--     is off. trg_derive_org_id passes (same org), so the immutable-refs guard is
--     the layer that raises. The target date already carries an active artist-A
--     booking, but the guard fires BEFORE the uniqueness index is ever evaluated.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE public.bookings
    SET status = 'confirmed', show_date_id = 'dddddddd-dddd-0001-0000-000000000000'
    WHERE id = 'eeeeeeee-eeee-0009-0000-000000000000'$$,
  '23514',
  null,
  'artist retarget of show_date_id throws 23514 even in producer_confirmation=false org'
);

RESET ROLE;

-- 17. The guard is role-independent: a superuser (RLS-bypassing) UPDATE that
--     changes show_date_id also throws 23514.
SELECT throws_ok(
  $$UPDATE public.bookings
    SET show_date_id = 'dddddddd-dddd-0001-0000-000000000000'
    WHERE id = 'eeeeeeee-eeee-000a-0000-000000000000'$$,
  '23514',
  null,
  'superuser retarget of show_date_id also throws 23514 (guard is role-independent)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- extend_offer_expiry RPC (SECURITY INVOKER — RLS gates which rows are affected)
-- dddddddd-dddd-0001 carries eeeeeeee-0001 and eeeeeeee-0002, both still
-- 'suggested' and untouched by any test above.
-- ────────────────────────────────────────────────────────────────────────────

-- 18. Producer of the booking's org extends expiry on both pending offers for the date.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT public.extend_offer_expiry('dddddddd-dddd-0001-0000-000000000000', 24)),
  2,
  'producer extends expiry on both suggested offers for the date'
);

RESET ROLE;

-- 19. offer_expires_at advanced by ~24h (within a 10-minute tolerance for test runtime).
SELECT ok(
  (SELECT offer_expires_at FROM public.bookings WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000')
    BETWEEN now() + interval '23 hours 55 minutes' AND now() + interval '24 hours 5 minutes',
  'offer_expires_at advanced by ~24h'
);

-- 20. A producer of a DIFFERENT org affects 0 rows — org_isolation hides
--     org b007's bookings from a non-member entirely, so the UPDATE inside the
--     RPC matches nothing (no error, just 0 rows returned).
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0005-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT public.extend_offer_expiry('dddddddd-dddd-0001-0000-000000000000', 24)),
  0,
  'producer of a different org affects 0 rows (org_isolation blocks visibility)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
