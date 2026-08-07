-- ISOLATION SUITE ★ — proves the RESTRICTIVE org_isolation policy keeps org A's
-- session out of org B's rows (read AND write), even when the caller holds a
-- GLOBAL producer role (has_role) — isolation rides on org membership, not role.
-- Super-admin (god-mode) sees everything.
--
--   aaaa…0001 super-admin   aaaa…00a2 org-A producer   aaaa…00b2 org-B producer
--   0000…a000 org A (iso-a) 0000…b000 org B (iso-b)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(15);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','iso-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00a2-0000-000000000000','authenticated','authenticated','iso-aprod@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00b2-0000-000000000000','authenticated','authenticated','iso-bprod@test.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','Iso A','iso-a'),
  ('00000000-0000-0000-0000-00000000b000','Iso B','iso-b');

INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');

-- GLOBAL producer role (drives the permissive write policies) …
-- … but per-org membership is what the restrictive isolation policy checks.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-00a2-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b000','aaaaaaaa-aaaa-00b2-0000-000000000000','producer');

INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('cccccccc-cccc-000a-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000a000'),
  ('cccccccc-cccc-000b-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000b000');
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('dddddddd-dddd-000a-0000-000000000000','cccccccc-cccc-000a-0000-000000000000','2099-01-01','20:00','00000000-0000-0000-0000-00000000a000'),
  ('dddddddd-dddd-000b-0000-000000000000','cccccccc-cccc-000b-0000-000000000000','2099-01-01','20:00','00000000-0000-0000-0000-00000000b000');

SET session_replication_role = DEFAULT;

-- ── Org-A producer: sees A, not B ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00a2-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),1,'A-prod sees own show');
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000b-0000-000000000000'),0,'A-prod cannot see B show');
SELECT is((SELECT count(*)::int FROM public.show_dates WHERE org_id='00000000-0000-0000-0000-00000000b000'),0,'A-prod sees zero B show_dates');
-- positive control: A-prod CAN create a show in its OWN org
SELECT lives_ok(
  $$INSERT INTO public.shows (program, sub_program, org_id)
    VALUES ('x','y','00000000-0000-0000-0000-00000000a000')$$,
  'A-prod can insert a show into its own org');
-- write isolation: cannot create a show in org B (restrictive WITH CHECK), despite global producer role
SELECT throws_ok(
  $$INSERT INTO public.shows (program, sub_program, org_id)
    VALUES ('x','y','00000000-0000-0000-0000-00000000b000')$$,
  '42501', null, 'A-prod cannot insert a show into org B');
-- write isolation: cannot move its own show across the org boundary
SELECT throws_ok(
  $$UPDATE public.shows SET org_id='00000000-0000-0000-0000-00000000b000'
    WHERE id='cccccccc-cccc-000a-0000-000000000000'$$,
  '42501', null, 'A-prod cannot move its show into org B');
RESET ROLE;

SELECT is((SELECT org_id FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),
          '00000000-0000-0000-0000-00000000a000'::uuid,
          'A show NOT moved — WITH CHECK blocked the cross-org update');

-- ── Org-B producer cannot see A ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00b2-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),0,'B-prod cannot see A show');
RESET ROLE;

-- ── Super-admin (god-mode) sees both ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id IN
            ('cccccccc-cccc-000a-0000-000000000000','cccccccc-cccc-000b-0000-000000000000')),2,
          'super-admin sees both orgs shows');
RESET ROLE;


-- ══ Active-org narrowing (x-active-org header) ═══════════════════════════════
-- The header narrows god-mode/multi-org reads to the org actually being viewed.
-- Everything above ran with NO header set, which is why those expectations
-- (including "super-admin sees both") are unchanged — absent header = no narrowing.

-- Super-admin viewing org A sees only org A.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}',true);
SELECT set_config('request.headers','{"x-active-org":"00000000-0000-0000-0000-00000000a000"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),1,
          'super-admin in org A sees A show');
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000b-0000-000000000000'),0,
          'super-admin in org A does NOT see B show');
-- …but WRITES are NOT fenced by the active-org header — only reads are (see
-- 20260806104215_active_org_scoping put the active-org conjunct on both, but it
-- was dropped from WITH CHECK in
-- 20260807104500_org_isolation_writecheck_drop_active_org.sql). The active-org
-- conjunct was dropped from org_isolation's WITH CHECK because it broke
-- legitimate writes: tenant tables derive org_id from an FK parent in a BEFORE
-- INSERT trigger, so demanding org_id = header on a server-derived, client-timing
-- dependent value is racy. is_org_member is now the sole write gate — and a
-- super-admin passes it for every org (god-mode), so a cross-org write succeeds
-- regardless of which org the header names. A non-member is still blocked by
-- is_org_member (asserted for the org-A producer above).
SELECT lives_ok(
  $$INSERT INTO public.shows (program, sub_program, org_id)
    VALUES ('x','y','00000000-0000-0000-0000-00000000b000')$$,
  'super-admin write is not fenced by the active-org header (is_org_member is the only write gate)');
RESET ROLE;

-- Switching the header switches the visible org.
SELECT set_config('request.headers','{"x-active-org":"00000000-0000-0000-0000-00000000b000"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000b-0000-000000000000'),1,
          'super-admin in org B sees B show');
RESET ROLE;

-- A malformed header must degrade to "no narrowing", never raise: this predicate runs
-- per row on every tenant table, so an exception here would be a total outage.
SELECT set_config('request.headers','{"x-active-org":"not-a-uuid"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id IN
            ('cccccccc-cccc-000a-0000-000000000000','cccccccc-cccc-000b-0000-000000000000')),2,
          'malformed active-org header is ignored rather than fatal');
RESET ROLE;

-- The header can only ever NARROW. Org-B's producer naming org A gets nothing:
-- the conjunct is ANDed with is_org_member, so forging it grants no new access.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00b2-0000-000000000000","role":"authenticated"}',true);
SELECT set_config('request.headers','{"x-active-org":"00000000-0000-0000-0000-00000000a000"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.shows WHERE id='cccccccc-cccc-000a-0000-000000000000'),0,
          'forged active-org header cannot widen a non-member into org A');
RESET ROLE;
SELECT set_config('request.headers','',true);

SELECT * FROM finish();
ROLLBACK;
