-- pgTAP: capability-aware write RLS on public.shows (Plan 3, Phase 1.1).
-- Proves: producer INSERT/UPDATE gated on producer_can_manage_productions,
-- producer DELETE gated on producer_can_hard_delete_productions, admin always
-- allowed, producer SELECT always works (read-only floor).
--   11111111-…-0001 admin   11111111-…-0002 producer   22222222-…-0001 org
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0001-4001-8001-000000000001','authenticated','authenticated','shows-admin@t.com',now(),now()),
  ('11111111-0001-4001-8001-000000000002','authenticated','authenticated','shows-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0001-4001-8001-000000000001','ShowsOrg','shows-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0001-4001-8001-000000000001','11111111-0001-4001-8001-000000000001','admin'),
  ('22222222-0001-4001-8001-000000000001','11111111-0001-4001-8001-000000000002','producer');
INSERT INTO public.shows (id, org_id, description) VALUES
  ('33333333-0001-4001-8001-000000000001','22222222-0001-4001-8001-000000000001', null),
  ('33333333-0001-4001-8001-0000000000a1','22222222-0001-4001-8001-000000000001', null);
SET session_replication_role = DEFAULT;

-- Act as producer (manage_productions default on, hard_delete default off).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0001-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.shows (id, org_id) values ('33333333-0001-4001-8001-0000000000b1','22222222-0001-4001-8001-000000000001') $$,
  'producer INSERT allowed when manage on');
SELECT isnt_empty(
  $$ select 1 from public.shows where org_id='22222222-0001-4001-8001-000000000001' $$,
  'producer SELECT always works');
UPDATE public.shows SET description='on1' WHERE id='33333333-0001-4001-8001-000000000001';
SELECT is(
  (SELECT description FROM public.shows WHERE id='33333333-0001-4001-8001-000000000001'),
  'on1', 'producer UPDATE applied when manage on');
RESET ROLE;

-- Disable manage_productions for the org.
SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled)
  VALUES ('22222222-0001-4001-8001-000000000001','producer_can_manage_productions',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0001-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.shows (org_id) values ('22222222-0001-4001-8001-000000000001') $$,
  '42501', NULL, 'producer INSERT denied when manage off');
UPDATE public.shows SET description='off1' WHERE id='33333333-0001-4001-8001-000000000001';
SELECT is(
  (SELECT description FROM public.shows WHERE id='33333333-0001-4001-8001-000000000001'),
  'on1', 'producer UPDATE no-op when manage off (row unchanged)');
-- hard_delete still off by default: producer DELETE no-ops (row persists).
DELETE FROM public.shows WHERE id='33333333-0001-4001-8001-000000000001';
SELECT isnt_empty(
  $$ select 1 from public.shows where id='33333333-0001-4001-8001-000000000001' $$,
  'producer DELETE no-op when hard_delete off (row persists)');
RESET ROLE;

-- Enable hard_delete_productions.
SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled)
  VALUES ('22222222-0001-4001-8001-000000000001','producer_can_hard_delete_productions',true);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0001-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.shows WHERE id='33333333-0001-4001-8001-000000000001';
SELECT is_empty(
  $$ select 1 from public.shows where id='33333333-0001-4001-8001-000000000001' $$,
  'producer DELETE allowed when hard_delete on');
RESET ROLE;

-- Admin can always delete.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0001-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.shows WHERE id='33333333-0001-4001-8001-0000000000a1';
SELECT is_empty(
  $$ select 1 from public.shows where id='33333333-0001-4001-8001-0000000000a1' $$,
  'admin DELETE always allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
