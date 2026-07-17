-- hire_orders + hire_order_imports: PDF engagement-sheet lifecycle
-- (draft -> ready -> issued -> countersigned, or any state -> void), gated by the
-- 'hire_orders' entitlement (org_entitlements.sql: default OFF) and org-isolated
-- like every other tenant table.
-- (defined in 20260717102508_hire_orders_schema.sql; enforce_hire_order_transition()
-- re-declared twice since -- in 20260717104220_hire_order_transition_freeze_assignment_
-- fields.sql to extend the freeze list and add SECURITY DEFINER SET search_path =
-- public, then in 20260717110023_hire_order_freeze_allow_null_on_delete.sql to let the
-- assignment links be cleared)
--
-- Guard functions under test (defined alongside the tables):
--   derive_org_for_hire_order()      BEFORE INSERT OR UPDATE OF booking_id/artist_id/
--                                     show_date_id: raises P0001 when a linked entity
--                                     belongs to a different org (mirrors
--                                     bookings_artist_org_guard.sql's trg_derive_org_id
--                                     mismatch case -- this guard rejects rather than
--                                     re-derives, since a hire order's org_id is its
--                                     own tenant boundary, not inherited).
--   enforce_hire_order_transition()  BEFORE UPDATE: legal set is
--                                     draft->{ready,void}, ready->{draft,issued,void},
--                                     issued->{countersigned,void},
--                                     countersigned->{void}. Once a row has left
--                                     'ready' (issued or countersigned) it also
--                                     freezes the document's own content --
--                                     data/fee_amount/fee_currency/terms_variant/
--                                     order_no/pdf_path -- absolutely, and freezes the
--                                     assignment links booking_id/artist_id/
--                                     show_date_id ASYMMETRICALLY: they may be CLEARED
--                                     to NULL (an ON DELETE SET NULL referential
--                                     action is an internal UPDATE and must not be
--                                     blocked -- an absolute freeze here hard-failed
--                                     delete_org) but never moved to a different
--                                     non-null value, in either direction.
--
-- RLS: producers/admins get full access gated additionally by is_feature_enabled
-- (WITH CHECK only -- writes require the entitlement, reads do not); artists get a
-- narrow SELECT of their own issued/countersigned orders only; org_isolation is
-- restrictive on top of both, same shape as org_entitlements.sql.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(29);

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- ── Fixtures (seeded under replica so none of the guard triggers above -- all
--    BEFORE INSERT/UPDATE OF the ref columns, or BEFORE UPDATE for the lifecycle
--    guard -- interfere with what is already internally-consistent seed data).
SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('aaaaaaaa-f0a1-0001-0000-000000000000','authenticated','authenticated','ho-producer-a@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-f0a2-0001-0000-000000000000','authenticated','authenticated','ho-producer-b@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-f0a1-0002-0000-000000000000','authenticated','authenticated','ho-artist-a@x.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000f0a1','HoOrgA','ho-org-a'),
  ('00000000-0000-0000-0000-00000000f0a2','HoOrgB','ho-org-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000f0a1','aaaaaaaa-f0a1-0001-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000f0a2','aaaaaaaa-f0a2-0001-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000f0a1','aaaaaaaa-f0a1-0002-0000-000000000000','artist');

-- Org A carries a SECOND artist / show_date / booking set purely so that a genuine
-- re-point (non-null value -> DIFFERENT non-null same-org value) is expressible --
-- that is now the only thing the assignment freeze rejects, so it must be tested
-- against real distinct rows rather than implied by the NULL-boundary cases.
INSERT INTO public.artists (id, org_id, name, user_id) VALUES
  ('bbbbbbbb-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','Ho Artist A','aaaaaaaa-f0a1-0002-0000-000000000000'),
  ('bbbbbbbb-f0a1-0002-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','Ho Artist A2',NULL),
  ('bbbbbbbb-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','Ho Artist B',NULL);

INSERT INTO public.shows (id, org_id, program, sub_program) VALUES
  ('cccccccc-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','theatre','ho-show-a'),
  ('cccccccc-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','theatre','ho-show-b');

INSERT INTO public.show_dates (id, org_id, show_id, date, session_1) VALUES
  ('dddddddd-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','cccccccc-f0a1-0001-0000-000000000000','2099-09-01','19:00'),
  ('dddddddd-f0a1-0002-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','cccccccc-f0a1-0001-0000-000000000000','2099-09-02','19:00'),
  ('dddddddd-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','cccccccc-f0a2-0001-0000-000000000000','2099-09-01','19:00');

-- Four org-A bookings with pairwise-distinct (show_date_id, artist_id) so none trip
-- bookings_active_artist_date_uniq: 0001=(sd1,a1) 0002=(sd2,a2) 0003=(sd1,a2) 0004=(sd2,a1).
-- 0003 is deliberately left unreferenced by any hire order, so it is a free re-point
-- target that cannot collide with hire_orders_active_booking_uniq and mask the P0001.
INSERT INTO public.bookings (id, org_id, show_date_id, artist_id, status) VALUES
  ('eeeeeeee-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','dddddddd-f0a1-0001-0000-000000000000','bbbbbbbb-f0a1-0001-0000-000000000000','suggested'),
  ('eeeeeeee-f0a1-0002-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','dddddddd-f0a1-0002-0000-000000000000','bbbbbbbb-f0a1-0002-0000-000000000000','suggested'),
  ('eeeeeeee-f0a1-0003-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','dddddddd-f0a1-0001-0000-000000000000','bbbbbbbb-f0a1-0002-0000-000000000000','suggested'),
  ('eeeeeeee-f0a1-0004-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','dddddddd-f0a1-0002-0000-000000000000','bbbbbbbb-f0a1-0001-0000-000000000000','suggested'),
  ('eeeeeeee-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','dddddddd-f0a2-0001-0000-000000000000','bbbbbbbb-f0a2-0001-0000-000000000000','suggested');

-- Baseline hire_orders rows, one per scenario below.
INSERT INTO public.hire_orders (id, org_id, order_no, status, artist_id, data) VALUES
  ('ffffffff-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-DRAFT-1','draft','bbbbbbbb-f0a1-0001-0000-000000000000','{}'),
  ('ffffffff-f0a1-0002-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-ISSUED-1','issued','bbbbbbbb-f0a1-0001-0000-000000000000','{}'),
  ('ffffffff-f0a1-0004-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-CHAIN-1','draft',NULL,'{}'),
  ('ffffffff-f0a1-0005-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-VOID-READY','ready',NULL,'{}'),
  ('ffffffff-f0a1-0006-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-VOID-CSGN','countersigned',NULL,'{}');
INSERT INTO public.hire_orders (id, org_id, order_no, status, booking_id, data) VALUES
  ('ffffffff-f0a1-0003-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-BOOKED-1','draft','eeeeeeee-f0a1-0001-0000-000000000000','{}');
-- HO-REPOINT-1: issued with all three links NON-NULL, so the full assignment truth
-- table (re-point / null / re-attach) can be walked on one row.
-- HO-FKDEL-1: issued, booking-linked, reserved for the ON DELETE SET NULL regression.
INSERT INTO public.hire_orders (id, org_id, order_no, status, booking_id, artist_id, show_date_id, data) VALUES
  ('ffffffff-f0a1-0007-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-REPOINT-1','issued','eeeeeeee-f0a1-0002-0000-000000000000','bbbbbbbb-f0a1-0002-0000-000000000000','dddddddd-f0a1-0002-0000-000000000000','{}'),
  ('ffffffff-f0a1-0008-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','HO-FKDEL-1','issued','eeeeeeee-f0a1-0004-0000-000000000000',NULL,NULL,'{}');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Shape: both tables, enum values
-- ────────────────────────────────────────────────────────────────────────────
SELECT has_table('public', 'hire_orders', 'hire_orders exists');
SELECT has_table('public', 'hire_order_imports', 'hire_order_imports exists');

SELECT is(
  (SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
   FROM pg_enum WHERE enumtypid = 'public.hire_order_status'::regtype),
  ARRAY['draft','ready','issued','countersigned','void'],
  'hire_order_status enum has the five lifecycle values in order');

-- ────────────────────────────────────────────────────────────────────────────
-- Constraints
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.hire_orders (org_id, order_no, data)
    VALUES ('00000000-0000-0000-0000-00000000f0a1', 'HO-DRAFT-1', '{}'::jsonb)$$,
  '23505', NULL,
  'duplicate (org_id, order_no) is rejected');

SELECT throws_ok(
  $$INSERT INTO public.hire_orders (org_id, order_no, data, booking_id)
    VALUES ('00000000-0000-0000-0000-00000000f0a1', 'HO-BOOKED-2', '{}'::jsonb, 'eeeeeeee-f0a1-0001-0000-000000000000')$$,
  '23505', NULL,
  'a second active hire order on the same booking is rejected (partial unique index)');

-- ────────────────────────────────────────────────────────────────────────────
-- RLS: org isolation
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-f0a2-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE org_id = '00000000-0000-0000-0000-00000000f0a1'),
  0, 'producer of org B sees no rows for org A');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS: artist can read own issued order but not own draft order
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-f0a1-0002-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'),
  1, 'artist can select their own issued order');
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders WHERE id = 'ffffffff-f0a1-0001-0000-000000000000'),
  0, 'artist cannot select their own draft order');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS + entitlement: producer INSERT is gated by is_feature_enabled(org,'hire_orders')
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.org_entitlements (org_id, feature, enabled)
VALUES ('00000000-0000-0000-0000-00000000f0a1', 'hire_orders', false);

SELECT pg_temp.act_as('aaaaaaaa-f0a1-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.hire_orders (org_id, order_no, data)
    VALUES ('00000000-0000-0000-0000-00000000f0a1', 'HO-GATE-1', '{}'::jsonb)$$,
  '42501', NULL,
  'producer insert is rejected while the hire_orders entitlement is disabled');
RESET ROLE;

UPDATE public.org_entitlements SET enabled = true
  WHERE org_id = '00000000-0000-0000-0000-00000000f0a1' AND feature = 'hire_orders';

SELECT pg_temp.act_as('aaaaaaaa-f0a1-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.hire_orders (org_id, order_no, data)
    VALUES ('00000000-0000-0000-0000-00000000f0a1', 'HO-GATE-2', '{}'::jsonb)$$,
  'producer insert succeeds once the hire_orders entitlement is enabled');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- Lifecycle guard: forward chain, backward step, void from any state
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'ready' WHERE id = 'ffffffff-f0a1-0004-0000-000000000000'$$,
  'draft -> ready is allowed');
SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'issued' WHERE id = 'ffffffff-f0a1-0004-0000-000000000000'$$,
  'ready -> issued is allowed');
SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'countersigned' WHERE id = 'ffffffff-f0a1-0004-0000-000000000000'$$,
  'issued -> countersigned is allowed');

SELECT throws_ok(
  $$UPDATE public.hire_orders SET status = 'draft' WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'$$,
  NULL, NULL,
  'issued -> draft is rejected');

SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'void' WHERE id = 'ffffffff-f0a1-0005-0000-000000000000'$$,
  'ready -> void is allowed');
SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'void' WHERE id = 'ffffffff-f0a1-0006-0000-000000000000'$$,
  'countersigned -> void is allowed');
-- draft and issued are separate elsif branches in enforce_hire_order_transition's
-- legal-set chain (not shared with ready/countersigned above), so each needs its own
-- any->void exercise. HO-DRAFT-1 (ffffffff-f0a1-0001) is otherwise only referenced by
-- its order_no string in the duplicate-order_no throws_ok above, which never mutates
-- this row, so it is still 'draft' here.
SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'void' WHERE id = 'ffffffff-f0a1-0001-0000-000000000000'$$,
  'draft -> void is allowed');

-- ────────────────────────────────────────────────────────────────────────────
-- Immutability: an issued row's document fields cannot be edited (status machinery
-- may still move it, exercised above).
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$UPDATE public.hire_orders SET data = '{"changed":true}'::jsonb WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'$$,
  NULL, NULL,
  'updating data on an issued hire order is rejected');

-- ────────────────────────────────────────────────────────────────────────────
-- Assignment links on an issued row: "allow nulling, block re-pointing"
-- (20260717110023_hire_order_freeze_allow_null_on_delete.sql). Walked as the full
-- truth table on HO-REPOINT-1 (ffffffff-f0a1-0007), which starts issued with all
-- three links non-null. Every attempt targets a SAME-ORG value, so
-- derive_org_for_hire_order (a BEFORE trigger sorting alphabetically ahead of
-- enforce_hire_order_transition) never raises its cross-org exception first and mask
-- the freeze raise -- any P0001 below is unambiguously the freeze check.
-- ────────────────────────────────────────────────────────────────────────────

-- old=value -> new=DIFFERENT non-null value: the real threat, must still reject.
-- Ordered first: all three reject, so the row is unchanged for the null cases below.
SELECT throws_ok(
  $$UPDATE public.hire_orders SET booking_id = 'eeeeeeee-f0a1-0003-0000-000000000000' WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  're-pointing booking_id at a different booking on an issued hire order is rejected');
SELECT throws_ok(
  $$UPDATE public.hire_orders SET artist_id = 'bbbbbbbb-f0a1-0001-0000-000000000000' WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  're-pointing artist_id at a different artist on an issued hire order is rejected');
SELECT throws_ok(
  $$UPDATE public.hire_orders SET show_date_id = 'dddddddd-f0a1-0001-0000-000000000000' WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  're-pointing show_date_id at a different show date on an issued hire order is rejected');

-- old=value -> new=NULL: must PASS. This is the shape an ON DELETE SET NULL
-- referential action takes, and rejecting it is what broke delete_org (see the
-- FK-delete regression below). These three mutate the row.
SELECT lives_ok(
  $$UPDATE public.hire_orders SET booking_id = NULL WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'clearing booking_id on an issued hire order is allowed');
SELECT lives_ok(
  $$UPDATE public.hire_orders SET artist_id = NULL WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'clearing artist_id on an issued hire order is allowed');
SELECT lives_ok(
  $$UPDATE public.hire_orders SET show_date_id = NULL WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'clearing show_date_id on an issued hire order is allowed');

-- old=NULL -> new=value: cannot re-attach after nulling. Runs on the same row, whose
-- booking_id the lives_ok above just set to NULL.
SELECT throws_ok(
  $$UPDATE public.hire_orders SET booking_id = 'eeeeeeee-f0a1-0003-0000-000000000000' WHERE id = 'ffffffff-f0a1-0007-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  're-attaching booking_id after it was cleared on an issued hire order is rejected');

-- ────────────────────────────────────────────────────────────────────────────
-- Regression (the scenario that actually broke): booking_id/artist_id/show_date_id
-- carry ON DELETE SET NULL FKs, which Postgres implements as an internal UPDATE that
-- fires enforce_hire_order_transition. An absolute freeze rejected the referential
-- action itself, hard-failing delete_org for any org that had ever issued a hire
-- order. Deleting a referenced booking must succeed and simply clear the link.
-- ────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$DELETE FROM public.bookings WHERE id = 'eeeeeeee-f0a1-0004-0000-000000000000'$$,
  'deleting a booking referenced by an issued hire order succeeds (ON DELETE SET NULL)');
SELECT is(
  (SELECT booking_id FROM public.hire_orders WHERE id = 'ffffffff-f0a1-0008-0000-000000000000'),
  NULL::uuid,
  'the deleted booking link is cleared and the issued hire order itself survives');

-- issued -> void: run last on HO-ISSUED-1 (after the data-edit throws_ok above, which
-- rejects and so leaves its status unchanged at 'issued') to cover the fourth
-- any->void leg alongside ready/countersigned and draft above.
SELECT lives_ok(
  $$UPDATE public.hire_orders SET status = 'void' WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'$$,
  'issued -> void is allowed');

-- ────────────────────────────────────────────────────────────────────────────
-- Org consistency: a booking from a different org cannot be attached
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.hire_orders (org_id, order_no, data, booking_id)
    VALUES ('00000000-0000-0000-0000-00000000f0a1', 'HO-MISMATCH-1', '{}'::jsonb, 'eeeeeeee-f0a2-0001-0000-000000000000')$$,
  'P0001', NULL,
  'attaching a booking from a different org is rejected');

SELECT * FROM finish();
ROLLBACK;
