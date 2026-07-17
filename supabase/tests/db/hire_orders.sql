-- hire_orders + hire_order_imports: PDF engagement-sheet lifecycle
-- (draft -> ready -> issued -> countersigned, or any state -> void), gated by the
-- 'hire_orders' entitlement (org_entitlements.sql: default OFF) and org-isolated
-- like every other tenant table.
-- (defined in 20260717102508_hire_orders_schema.sql; enforce_hire_order_transition()
-- re-declared in 20260717104220_hire_order_transition_freeze_assignment_fields.sql to
-- extend the freeze list and add SECURITY DEFINER SET search_path = public)
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
--                                     countersigned->{void}; and freezes data/fee_amount/
--                                     fee_currency/terms_variant/order_no/pdf_path/
--                                     booking_id/artist_id/show_date_id once a row has
--                                     left 'ready' (issued or countersigned) -- the
--                                     assignment fields were added by the follow-up
--                                     migration above so an issued/countersigned order
--                                     can no longer be silently re-pointed at a
--                                     different booking/artist/show_date.
--
-- RLS: producers/admins get full access gated additionally by is_feature_enabled
-- (WITH CHECK only -- writes require the entitlement, reads do not); artists get a
-- narrow SELECT of their own issued/countersigned orders only; org_isolation is
-- restrictive on top of both, same shape as org_entitlements.sql.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

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

INSERT INTO public.artists (id, org_id, name, user_id) VALUES
  ('bbbbbbbb-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','Ho Artist A','aaaaaaaa-f0a1-0002-0000-000000000000'),
  ('bbbbbbbb-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','Ho Artist B',NULL);

INSERT INTO public.shows (id, org_id, program, sub_program) VALUES
  ('cccccccc-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','theatre','ho-show-a'),
  ('cccccccc-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','theatre','ho-show-b');

INSERT INTO public.show_dates (id, org_id, show_id, date, session_1) VALUES
  ('dddddddd-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','cccccccc-f0a1-0001-0000-000000000000','2099-09-01','19:00'),
  ('dddddddd-f0a2-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a2','cccccccc-f0a2-0001-0000-000000000000','2099-09-01','19:00');

INSERT INTO public.bookings (id, org_id, show_date_id, artist_id, status) VALUES
  ('eeeeeeee-f0a1-0001-0000-000000000000','00000000-0000-0000-0000-00000000f0a1','dddddddd-f0a1-0001-0000-000000000000','bbbbbbbb-f0a1-0001-0000-000000000000','suggested'),
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

-- Regression for the freeze-list gap: booking_id/artist_id/show_date_id were added to
-- the immutability freeze condition by 20260717104220_hire_order_transition_freeze_
-- assignment_fields.sql. HO-ISSUED-1 (ffffffff-f0a1-0002) starts issued with
-- booking_id=NULL, show_date_id=NULL, artist_id=bbbbbbbb-f0a1-0001 (Ho Artist A); none
-- of the prior throws_ok updates on this row change its state (all rejected), so it is
-- still issued with those same values here. Each attempt below changes exactly one
-- assignment column to a same-org value (avoiding derive_org_for_hire_order's
-- cross-org raise, which fires first and would mask the immutability raise), so the
-- P0001 below is unambiguously from enforce_hire_order_transition's freeze check.
SELECT throws_ok(
  $$UPDATE public.hire_orders SET booking_id = 'eeeeeeee-f0a1-0001-0000-000000000000' WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  'updating booking_id on an issued hire order is rejected');
SELECT throws_ok(
  $$UPDATE public.hire_orders SET artist_id = NULL WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  'updating artist_id on an issued hire order is rejected');
SELECT throws_ok(
  $$UPDATE public.hire_orders SET show_date_id = 'dddddddd-f0a1-0001-0000-000000000000' WHERE id = 'ffffffff-f0a1-0002-0000-000000000000'$$,
  'P0001', 'issued hire orders are immutable',
  'updating show_date_id on an issued hire order is rejected');

-- issued -> void: run last on this row (after the freeze checks above, which all
-- reject and so leave the row's status unchanged at 'issued') to cover the fourth
-- any->void leg alongside ready/countersigned above and draft above.
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
