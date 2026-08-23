-- pgTAP: per-(cast x production) fee (Wireflow v3 Phase 4, Task B1).
-- Uniform org-scoped RLS kit (mirrors show_date_skill_drops): member SELECT,
-- admin/producer write, RESTRICTIVE org_isolation. Plan (11): admin INSERT/SELECT,
-- producer INSERT, artist write denied, cross-org member cannot SELECT, UNIQUE holds,
-- cross-org INSERT guard, and the BEFORE UPDATE symmetry of that guard (a direct
-- org_id rewrite is re-derived back, and moving show_id to a foreign org raises).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0004-4001-8001-000000000001','authenticated','authenticated','cpf-admin@t.com',now(),now()),
  ('11111111-0004-4001-8001-000000000002','authenticated','authenticated','cpf-prod@t.com',now(),now()),
  ('11111111-0004-4001-8001-000000000003','authenticated','authenticated','cpf-artist@t.com',now(),now()),
  ('11111111-0004-4001-8001-000000000004','authenticated','authenticated','cpf-borg@t.com',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-0004-4001-8001-000000000001','CpfOrgA','cpf-org-a'),
  ('22222222-0004-4001-8001-000000000002','CpfOrgB','cpf-org-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0004-4001-8001-000000000001','11111111-0004-4001-8001-000000000001','admin'),
  ('22222222-0004-4001-8001-000000000001','11111111-0004-4001-8001-000000000002','producer'),
  ('22222222-0004-4001-8001-000000000001','11111111-0004-4001-8001-000000000003','artist'),
  ('22222222-0004-4001-8001-000000000002','11111111-0004-4001-8001-000000000004','admin');

INSERT INTO public.casts (id, name, org_id) VALUES
  ('55555555-0004-4001-8001-000000000001','Cast A','22222222-0004-4001-8001-000000000001'),
  ('55555555-0004-4001-8001-000000000002','Cast A2','22222222-0004-4001-8001-000000000001'),
  ('55555555-0004-4001-8001-000000000003','Cast B','22222222-0004-4001-8001-000000000002');

INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('cccccccc-0004-4001-8001-000000000001','theatre','musical','22222222-0004-4001-8001-000000000001'),
  ('cccccccc-0004-4001-8001-000000000002','theatre','musical','22222222-0004-4001-8001-000000000002');

SET session_replication_role = DEFAULT;

-- ── Admin of org A: INSERT + SELECT allowed ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.cast_production_fees (cast_id, show_id, fee_amount, fee_basis)
     values ('55555555-0004-4001-8001-000000000001','cccccccc-0004-4001-8001-000000000001',500,'per_date') $$,
  'admin INSERT cast_production_fee allowed');
SELECT isnt_empty(
  $$ select 1 from public.cast_production_fees where cast_id='55555555-0004-4001-8001-000000000001' and show_id='cccccccc-0004-4001-8001-000000000001' $$,
  'admin SELECT own-org fee');
RESET ROLE;

-- ── Producer of org A: INSERT allowed ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.cast_production_fees (cast_id, show_id, fee_amount, fee_basis)
     values ('55555555-0004-4001-8001-000000000002','cccccccc-0004-4001-8001-000000000001',750,'total') $$,
  'producer INSERT cast_production_fee allowed');
RESET ROLE;

-- ── Artist of org A: INSERT denied ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.cast_production_fees (cast_id, show_id, fee_amount)
     values ('55555555-0004-4001-8001-000000000001','cccccccc-0004-4001-8001-000000000001',999) $$,
  '42501', NULL, 'artist INSERT cast_production_fee denied');
RESET ROLE;

-- ── Admin of org B: cannot SELECT org A's fee (cross-org isolation) ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ select 1 from public.cast_production_fees where cast_id='55555555-0004-4001-8001-000000000001' and show_id='cccccccc-0004-4001-8001-000000000001' $$,
  'org B admin cannot see org A fee');
-- positive control + cross-org guard: org B admin can insert its OWN org's fee
SELECT lives_ok(
  $$ insert into public.cast_production_fees (cast_id, show_id, fee_amount)
     values ('55555555-0004-4001-8001-000000000003','cccccccc-0004-4001-8001-000000000002',300) $$,
  'org B admin can insert its own org fee');
RESET ROLE;

-- ── UNIQUE(cast_id, show_id) holds ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.cast_production_fees (cast_id, show_id, fee_amount)
     values ('55555555-0004-4001-8001-000000000001','cccccccc-0004-4001-8001-000000000001',111) $$,
  '23505', NULL, 'UNIQUE(cast_id, show_id) enforced');
RESET ROLE;

-- ── Cross-org guard: cast and show from different orgs raises ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.cast_production_fees (cast_id, show_id, fee_amount)
     values ('55555555-0004-4001-8001-000000000001','cccccccc-0004-4001-8001-000000000002',222) $$,
  'P0001', 'cast and production belong to different orgs', 'cross-org cast/show guard raises');
RESET ROLE;

-- ── BEFORE UPDATE guard symmetry: a direct attempt to move org A's existing fee
--    row's org_id to org B is re-derived back to org A (the trigger recomputes
--    NEW.org_id from show_id regardless of what the UPDATE set it to), so the row
--    never actually lands in org B. ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ update public.cast_production_fees set org_id = '22222222-0004-4001-8001-000000000002'
     where cast_id='55555555-0004-4001-8001-000000000001' and show_id='cccccccc-0004-4001-8001-000000000001' $$,
  'UPDATE attempting to move org_id to a foreign org does not error (re-derived instead)');
SELECT results_eq(
  $$ select org_id from public.cast_production_fees where cast_id='55555555-0004-4001-8001-000000000001' and show_id='cccccccc-0004-4001-8001-000000000001' $$,
  $$ values ('22222222-0004-4001-8001-000000000001'::uuid) $$,
  'row org_id stays org A after the UPDATE (BEFORE UPDATE trigger re-derived it)');
RESET ROLE;

-- ── UPDATE cannot re-point an existing row at a foreign-org show either (same
--    cross-org cast/show guard as INSERT, now proven on UPDATE). ──
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ update public.cast_production_fees set show_id = 'cccccccc-0004-4001-8001-000000000002'
     where cast_id='55555555-0004-4001-8001-000000000001' and show_id='cccccccc-0004-4001-8001-000000000001' $$,
  'P0001', 'cast and production belong to different orgs', 'UPDATE moving show_id cross-org raises (BEFORE UPDATE guard)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
