-- pgTAP: capability-aware write RLS on show_assignments (Plan 3, Phase 1.6).
-- Producer INSERT/UPDATE/DELETE gated on producer_can_manage_ownership; producer
-- SELECT ALWAYS works (read-only floor, the reason the FOR ALL was split); admin always.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0006-4001-8001-000000000001','authenticated','authenticated','sa-admin@t.com',now(),now()),
  ('11111111-0006-4001-8001-000000000002','authenticated','authenticated','sa-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0006-4001-8001-000000000001','SaOrg','sa-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0006-4001-8001-000000000001','11111111-0006-4001-8001-000000000001','admin'),
  ('22222222-0006-4001-8001-000000000001','11111111-0006-4001-8001-000000000002','producer');
INSERT INTO public.show_assignments (id, producer_user_id, program, org_id) VALUES
  ('88888888-0006-4001-8001-000000000001','11111111-0006-4001-8001-000000000002','P1','22222222-0006-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (manage_ownership on by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ insert into public.show_assignments (producer_user_id, program, org_id) values ('11111111-0006-4001-8001-000000000002','P2','22222222-0006-4001-8001-000000000001') $$, 'producer INSERT show_assignment allowed when manage on');
UPDATE public.show_assignments SET sub_program='on1' WHERE id='88888888-0006-4001-8001-000000000001';
SELECT is((SELECT sub_program FROM public.show_assignments WHERE id='88888888-0006-4001-8001-000000000001'), 'on1', 'producer UPDATE applied when manage on');
SELECT isnt_empty($$ select 1 from public.show_assignments where org_id='22222222-0006-4001-8001-000000000001' $$, 'producer SELECT works when manage on');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-0006-4001-8001-000000000001','producer_can_manage_ownership',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ insert into public.show_assignments (producer_user_id, program, org_id) values ('11111111-0006-4001-8001-000000000002','Blocked','22222222-0006-4001-8001-000000000001') $$, '42501', NULL, 'producer INSERT denied when manage off');
SELECT isnt_empty($$ select 1 from public.show_assignments where org_id='22222222-0006-4001-8001-000000000001' $$, 'producer SELECT STILL works when manage off (read floor)');
UPDATE public.show_assignments SET sub_program='off1' WHERE id='88888888-0006-4001-8001-000000000001';
SELECT is((SELECT sub_program FROM public.show_assignments WHERE id='88888888-0006-4001-8001-000000000001'), 'on1', 'producer UPDATE no-op when manage off');
RESET ROLE;

-- Admin always allowed.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ insert into public.show_assignments (producer_user_id, program, org_id) values ('11111111-0006-4001-8001-000000000002','P3','22222222-0006-4001-8001-000000000001') $$, 'admin INSERT always allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
