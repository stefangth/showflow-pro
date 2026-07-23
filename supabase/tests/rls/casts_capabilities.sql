-- pgTAP: capability-aware write RLS on casts + cast_members (Plan 3, Phase 1.3).
-- Producer INSERT/UPDATE casts + INSERT/DELETE cast_members gated on
-- producer_can_manage_casts; casts DELETE stays admin-only; SELECT always.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0003-4001-8001-000000000001','authenticated','authenticated','ca-admin@t.com',now(),now()),
  ('11111111-0003-4001-8001-000000000002','authenticated','authenticated','ca-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0003-4001-8001-000000000001','CaOrg','ca-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0003-4001-8001-000000000001','11111111-0003-4001-8001-000000000001','admin'),
  ('22222222-0003-4001-8001-000000000001','11111111-0003-4001-8001-000000000002','producer');
INSERT INTO public.casts (id, name, org_id) VALUES
  ('55555555-0003-4001-8001-000000000001','Cast One','22222222-0003-4001-8001-000000000001'),
  ('55555555-0003-4001-8001-000000000002','Cast Two','22222222-0003-4001-8001-000000000001');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('66666666-0003-4001-8001-000000000001','Artist One','22222222-0003-4001-8001-000000000001'),
  ('66666666-0003-4001-8001-000000000002','Artist Two','22222222-0003-4001-8001-000000000001');
INSERT INTO public.cast_members (cast_id, artist_id, org_id) VALUES
  ('55555555-0003-4001-8001-000000000001','66666666-0003-4001-8001-000000000001','22222222-0003-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (manage_casts on by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0003-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.casts (name, org_id) values ('New Cast','22222222-0003-4001-8001-000000000001') $$,
  'producer INSERT cast allowed when manage on');
UPDATE public.casts SET description='on1' WHERE id='55555555-0003-4001-8001-000000000001';
SELECT is((SELECT description FROM public.casts WHERE id='55555555-0003-4001-8001-000000000001'), 'on1', 'producer UPDATE cast applied when manage on');
SELECT lives_ok(
  $$ insert into public.cast_members (cast_id, artist_id, org_id) values ('55555555-0003-4001-8001-000000000001','66666666-0003-4001-8001-000000000002','22222222-0003-4001-8001-000000000001') $$,
  'producer INSERT cast_member allowed when manage on');
DELETE FROM public.casts WHERE id='55555555-0003-4001-8001-000000000002';
SELECT isnt_empty($$ select 1 from public.casts where id='55555555-0003-4001-8001-000000000002' $$, 'producer DELETE cast no-op (casts delete admin-only)');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled)
  VALUES ('22222222-0003-4001-8001-000000000001','producer_can_manage_casts',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0003-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.casts (name, org_id) values ('Blocked','22222222-0003-4001-8001-000000000001') $$,
  '42501', NULL, 'producer INSERT cast denied when manage off');
SELECT throws_ok(
  $$ insert into public.cast_members (cast_id, artist_id, org_id) values ('55555555-0003-4001-8001-000000000001','66666666-0003-4001-8001-000000000001','22222222-0003-4001-8001-000000000001') $$,
  '42501', NULL, 'producer INSERT cast_member denied when manage off');
DELETE FROM public.cast_members WHERE cast_id='55555555-0003-4001-8001-000000000001' AND artist_id='66666666-0003-4001-8001-000000000001';
SELECT isnt_empty($$ select 1 from public.cast_members where cast_id='55555555-0003-4001-8001-000000000001' and artist_id='66666666-0003-4001-8001-000000000001' $$, 'producer DELETE cast_member no-op when manage off');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0003-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.casts WHERE id='55555555-0003-4001-8001-000000000002';
SELECT is_empty($$ select 1 from public.casts where id='55555555-0003-4001-8001-000000000002' $$, 'admin DELETE cast allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
