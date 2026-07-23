-- pgTAP: capability-aware write RLS on artists (Plan 3, Phase 1.4).
-- Producer UPDATE gated on producer_can_edit_artists; producer INSERT gated on
-- producer_can_add_artists (new policy); admin always; SELECT always (floor).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0004-4001-8001-000000000001','authenticated','authenticated','ar-admin@t.com',now(),now()),
  ('11111111-0004-4001-8001-000000000002','authenticated','authenticated','ar-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0004-4001-8001-000000000001','ArOrg','ar-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0004-4001-8001-000000000001','11111111-0004-4001-8001-000000000001','admin'),
  ('22222222-0004-4001-8001-000000000001','11111111-0004-4001-8001-000000000002','producer');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('66666666-0004-4001-8001-000000000001','Artist One','22222222-0004-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (add_artists + edit_artists on by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.artists (name, org_id) values ('Added','22222222-0004-4001-8001-000000000001') $$,
  'producer INSERT artist allowed when add_artists on');
UPDATE public.artists SET bio='on1' WHERE id='66666666-0004-4001-8001-000000000001';
SELECT is((SELECT bio FROM public.artists WHERE id='66666666-0004-4001-8001-000000000001'), 'on1', 'producer UPDATE artist applied when edit on');
SELECT isnt_empty($$ select 1 from public.artists where org_id='22222222-0004-4001-8001-000000000001' $$, 'producer SELECT always works');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES
  ('22222222-0004-4001-8001-000000000001','producer_can_add_artists',false),
  ('22222222-0004-4001-8001-000000000001','producer_can_edit_artists',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.artists (name, org_id) values ('Blocked','22222222-0004-4001-8001-000000000001') $$,
  '42501', NULL, 'producer INSERT artist denied when add_artists off');
UPDATE public.artists SET bio='off1' WHERE id='66666666-0004-4001-8001-000000000001';
SELECT is((SELECT bio FROM public.artists WHERE id='66666666-0004-4001-8001-000000000001'), 'on1', 'producer UPDATE no-op when edit off');
RESET ROLE;

-- Admin always allowed (add + edit).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0004-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.artists (name, org_id) values ('AdminAdd','22222222-0004-4001-8001-000000000001') $$,
  'admin INSERT artist always allowed');
UPDATE public.artists SET bio='adm' WHERE id='66666666-0004-4001-8001-000000000001';
SELECT is((SELECT bio FROM public.artists WHERE id='66666666-0004-4001-8001-000000000001'), 'adm', 'admin UPDATE artist always allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
