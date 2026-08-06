-- The booking_flow module's database floor.
--
-- Source migration: <timestamp>_booking_flow_write_gate.sql. Three RESTRICTIVE
-- policies on public.bookings (booking_flow_required_insert / _update / _delete)
-- close writes for an org whose booking_flow entitlement is off, and
-- promote_understudy_on_cancellation() early-returns for the same org.
--
-- Two invariants this file exists to hold:
--   * SELECT stays open. The gate is INSERT/UPDATE/DELETE only, never FOR ALL, so
--     a producer in an unentitled org can still read who is already confirmed.
--     Tests 4 and 12 both guard that, structurally and behaviourally.
--   * SECURITY DEFINER paths still work. cascade_cancel_bookings_on_date_cancel is
--     owned by the bookings table owner on a table without FORCE ROW LEVEL
--     SECURITY, so cancelling a show date still cascades to its bookings even for
--     an unentitled org (test 16). If that ever regresses, cancelling a date in an
--     unentitled org would silently leave its bookings active.
--
-- Every unentitled assertion is paired with the same operation in an entitled org,
-- so a failure means "the entitlement gate", not "some other policy".
--
-- UUID legend (all test-only, rolled back at the end):
--   …bf01 / …bf02   organizations: entitled / unentitled
--   …bf11 / …bf12   auth users: producer in the unentitled / entitled org
--   …bf13           auth user: artist in the unentitled org
--   …bf14           auth user: admin in the unentitled org (show-date cancellation)
--   …bf2N           artists
--   …bf3N           shows
--   …bf4N / …bf5N   show_dates: unentitled org / entitled org
--   …bf6N           bookings

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures. session_replication_role = replica disables FK and user triggers so
-- the rows land exactly as written (org_id is supplied explicitly rather than
-- derived, and no status-sync / notification triggers fire during seeding).
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000bf11','authenticated','authenticated','bf-prod-unent@test.com',now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-00000000bf12','authenticated','authenticated','bf-prod-ent@test.com',  now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-00000000bf13','authenticated','authenticated','bf-artist-unent@test.com',now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-00000000bf14','authenticated','authenticated','bf-admin-unent@test.com', now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000bf01','BF Entitled',  'bf-entitled'),
  ('00000000-0000-0000-0000-00000000bf02','BF Unentitled','bf-unentitled');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000bf02','00000000-0000-0000-0000-00000000bf11','producer'),
  ('00000000-0000-0000-0000-00000000bf01','00000000-0000-0000-0000-00000000bf12','producer'),
  ('00000000-0000-0000-0000-00000000bf02','00000000-0000-0000-0000-00000000bf13','artist'),
  ('00000000-0000-0000-0000-00000000bf02','00000000-0000-0000-0000-00000000bf14','admin');

INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('00000000-0000-0000-0000-00000000bf21','BF Artist U1','00000000-0000-0000-0000-00000000bf13','00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf22','BF Artist U2', NULL, '00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf23','BF Artist U3', NULL, '00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf24','BF Artist U4', NULL, '00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf25','BF Artist E1', NULL, '00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf26','BF Artist E2', NULL, '00000000-0000-0000-0000-00000000bf01');

INSERT INTO public.shows (id, program, sub_program, main_cast_slots, understudy_slots, org_id) VALUES
  ('00000000-0000-0000-0000-00000000bf31','bf-unent','main', 1, 1, '00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf32','bf-ent',  'main', 1, 1, '00000000-0000-0000-0000-00000000bf01');

-- Unentitled-org dates (one per scenario: the partial unique index allows only one
-- active booking per (show_date, artist)).
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('00000000-0000-0000-0000-00000000bf41','00000000-0000-0000-0000-00000000bf31','2099-08-01','19:00'::time,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf42','00000000-0000-0000-0000-00000000bf31','2099-08-02','19:00'::time,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf43','00000000-0000-0000-0000-00000000bf31','2099-08-03','19:00'::time,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf44','00000000-0000-0000-0000-00000000bf31','2099-08-04','19:00'::time,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf45','00000000-0000-0000-0000-00000000bf31','2099-08-05','19:00'::time,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf46','00000000-0000-0000-0000-00000000bf31','2099-08-06','19:00'::time,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf47','00000000-0000-0000-0000-00000000bf31','2099-08-07','19:00'::time,'00000000-0000-0000-0000-00000000bf02');

-- Entitled-org control dates.
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('00000000-0000-0000-0000-00000000bf51','00000000-0000-0000-0000-00000000bf32','2099-09-01','19:00'::time,'00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf52','00000000-0000-0000-0000-00000000bf32','2099-09-02','19:00'::time,'00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf53','00000000-0000-0000-0000-00000000bf32','2099-09-03','19:00'::time,'00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf54','00000000-0000-0000-0000-00000000bf32','2099-09-04','19:00'::time,'00000000-0000-0000-0000-00000000bf01');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  -- unentitled org
  ('00000000-0000-0000-0000-00000000bf61','00000000-0000-0000-0000-00000000bf42','00000000-0000-0000-0000-00000000bf24','suggested',  false,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf62','00000000-0000-0000-0000-00000000bf43','00000000-0000-0000-0000-00000000bf24','suggested',  false,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf63','00000000-0000-0000-0000-00000000bf44','00000000-0000-0000-0000-00000000bf24','confirmed',  false,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf64','00000000-0000-0000-0000-00000000bf45','00000000-0000-0000-0000-00000000bf23','confirmed',  false,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf65','00000000-0000-0000-0000-00000000bf45','00000000-0000-0000-0000-00000000bf22','soft_booked',true, '00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf66','00000000-0000-0000-0000-00000000bf46','00000000-0000-0000-0000-00000000bf21','suggested',  false,'00000000-0000-0000-0000-00000000bf02'),
  ('00000000-0000-0000-0000-00000000bf67','00000000-0000-0000-0000-00000000bf47','00000000-0000-0000-0000-00000000bf24','confirmed',  false,'00000000-0000-0000-0000-00000000bf02'),
  -- entitled org
  ('00000000-0000-0000-0000-00000000bf68','00000000-0000-0000-0000-00000000bf52','00000000-0000-0000-0000-00000000bf25','suggested',  false,'00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf69','00000000-0000-0000-0000-00000000bf53','00000000-0000-0000-0000-00000000bf25','suggested',  false,'00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf6a','00000000-0000-0000-0000-00000000bf54','00000000-0000-0000-0000-00000000bf25','confirmed',  false,'00000000-0000-0000-0000-00000000bf01'),
  ('00000000-0000-0000-0000-00000000bf6b','00000000-0000-0000-0000-00000000bf54','00000000-0000-0000-0000-00000000bf26','soft_booked',true, '00000000-0000-0000-0000-00000000bf01');

SET session_replication_role = DEFAULT;

-- Only the second org is unentitled. The first is left with no org_entitlements
-- row at all, so it resolves through the registry default (booking_flow = on) —
-- which is the state every existing org is in.
INSERT INTO public.org_entitlements (org_id, feature, enabled)
VALUES ('00000000-0000-0000-0000-00000000bf02','booking_flow', false);

-- ────────────────────────────────────────────────────────────────────────────
-- 1-4. Policy shape.
-- ────────────────────────────────────────────────────────────────────────────

SELECT policy_cmd_is('public', 'bookings', 'booking_flow_required_insert', 'INSERT',
  'insert gate exists');
SELECT policy_cmd_is('public', 'bookings', 'booking_flow_required_update', 'UPDATE',
  'update gate exists');
SELECT policy_cmd_is('public', 'bookings', 'booking_flow_required_delete', 'DELETE',
  'delete gate exists');

-- SELECT must stay open: the confirmed cast has to remain readable.
SELECT is_empty(
  $$ select policyname from pg_policies
     where schemaname='public' and tablename='bookings'
       and permissive='RESTRICTIVE' and cmd='SELECT'
       and policyname like 'booking_flow_required%' $$,
  'no restrictive SELECT gate was added');

-- 5. Sanity: the fixture really turns the feature off.
SELECT is(
  public.is_feature_enabled('00000000-0000-0000-0000-00000000bf02', 'booking_flow'),
  false,
  'unentitled org reports the feature off');

-- ────────────────────────────────────────────────────────────────────────────
-- 6-7. INSERT. A producer in the unentitled org is denied by the WITH CHECK
--      (42501); the same producer role in an entitled org is not.
-- ────────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf11","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id)
    VALUES ('00000000-0000-0000-0000-00000000bf41',
            '00000000-0000-0000-0000-00000000bf24',
            'suggested', false,
            '00000000-0000-0000-0000-00000000bf02')$$,
  '42501', NULL,
  'unentitled org: producer INSERT is blocked by the restrictive WITH CHECK');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf12","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id)
    VALUES ('00000000-0000-0000-0000-00000000bf51',
            '00000000-0000-0000-0000-00000000bf25',
            'suggested', false,
            '00000000-0000-0000-0000-00000000bf01')$$,
  'entitled org: the same producer INSERT still succeeds');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 8-9. UPDATE. The restrictive USING filters the row out entirely, so no error
--      is raised — the update simply matches nothing and the row is unchanged.
-- ────────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf11","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.bookings SET status = 'soft_booked'
WHERE id = '00000000-0000-0000-0000-00000000bf61';
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf61'),
  'suggested',
  'unentitled org: producer UPDATE matched no rows, booking unchanged');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf12","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.bookings SET status = 'soft_booked'
WHERE id = '00000000-0000-0000-0000-00000000bf68';
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf68'),
  'soft_booked',
  'entitled org: the same producer UPDATE still applies');

-- ────────────────────────────────────────────────────────────────────────────
-- 10-11. DELETE, same shape.
-- ────────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf11","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DELETE FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf62';
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf62'),
  1,
  'unentitled org: producer DELETE matched no rows, booking still present');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf12","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DELETE FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf69';
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf69'),
  0,
  'entitled org: the same producer DELETE still applies');

-- ────────────────────────────────────────────────────────────────────────────
-- 12. The product requirement the FOR ALL shortcut would have broken: a producer
--     in an unentitled org can still READ the confirmed cast.
-- ────────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf11","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE id = '00000000-0000-0000-0000-00000000bf63' AND status = 'confirmed'),
  1,
  'unentitled org: producer can still read the confirmed booking');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. The artist offer-response path is closed too — "Artists can respond to own
--     offers" is permissive, so the restrictive gate composes with AND over it.
-- ────────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf13","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.bookings SET status = 'soft_booked'
WHERE id = '00000000-0000-0000-0000-00000000bf66';
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf66'),
  'suggested',
  'unentitled org: artist cannot accept their own offer');

-- ────────────────────────────────────────────────────────────────────────────
-- 14-15. promote_understudy_on_cancellation(). Cancelling the confirmed primary
--        runs as the (RLS-bypassing) owner, so only the trigger's own module gate
--        can stop the promotion.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.bookings SET status = 'cancelled'
WHERE id = '00000000-0000-0000-0000-00000000bf64';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf65'),
  'soft_booked',
  'unentitled org: understudy is NOT promoted when the primary cancels');

UPDATE public.bookings SET status = 'cancelled'
WHERE id = '00000000-0000-0000-0000-00000000bf6a';

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf6b'),
  'confirmed',
  'entitled org: understudy is still promoted when the primary cancels');

-- ────────────────────────────────────────────────────────────────────────────
-- 16. The SECURITY DEFINER escape hatch. An admin cancelling a show date is a
--     plain authenticated UPDATE on show_dates; the cascade to bookings happens in
--     cascade_cancel_bookings_on_date_cancel, which is SECURITY DEFINER and owned
--     by the bookings table owner, so it is not subject to the new gate. If this
--     ever fails, cancelling a date in an unentitled org leaves its bookings live.
-- ────────────────────────────────────────────────────────────────────────────

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bf14","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.show_dates SET status = 'cancelled'
WHERE id = '00000000-0000-0000-0000-00000000bf47';
RESET ROLE;

SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-00000000bf67'),
  'cancelled',
  'unentitled org: show-date cancellation still cascades to its bookings');

SELECT * FROM finish();
ROLLBACK;
