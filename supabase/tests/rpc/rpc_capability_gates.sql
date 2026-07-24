-- pgTAP: in-body capability gates on rename_org + bulk_import_artists (Phase 2).
-- rename_org: producer needs producer_can_rename_org (default off); admin always.
-- bulk_import_artists: plain producer needs producer_can_add_artists (default on); admin always.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-000b-4001-8001-000000000001','authenticated','authenticated','rpc-admin@t.com',now(),now()),
  ('11111111-000b-4001-8001-000000000002','authenticated','authenticated','rpc-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-000b-4001-8001-000000000001','Original','rpc-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-000b-4001-8001-000000000001','11111111-000b-4001-8001-000000000001','admin'),
  ('22222222-000b-4001-8001-000000000001','11111111-000b-4001-8001-000000000002','producer');
SET session_replication_role = DEFAULT;

-- rename_org: producer denied by default (rename_org off).
SELECT set_config('request.jwt.claims','{"sub":"11111111-000b-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ select public.rename_org('22222222-000b-4001-8001-000000000001','Nope') $$, '42501', NULL, 'producer rename denied when rename_org off (default)');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-000b-4001-8001-000000000001','producer_can_rename_org',true);
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims','{"sub":"11111111-000b-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.rename_org('22222222-000b-4001-8001-000000000001','ProducerRenamed');
RESET ROLE;
SELECT is((SELECT name FROM public.organizations WHERE id='22222222-000b-4001-8001-000000000001'), 'ProducerRenamed', 'producer rename allowed when rename_org on');

SELECT set_config('request.jwt.claims','{"sub":"11111111-000b-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.rename_org('22222222-000b-4001-8001-000000000001','AdminRenamed');
RESET ROLE;
SELECT is((SELECT name FROM public.organizations WHERE id='22222222-000b-4001-8001-000000000001'), 'AdminRenamed', 'admin rename always allowed');

-- bulk_import_artists: producer allowed by default (add_artists on).
SELECT set_config('request.jwt.claims','{"sub":"11111111-000b-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.bulk_import_artists('22222222-000b-4001-8001-000000000001', '[{"name":"Imp1"}]'::jsonb);
RESET ROLE;
SELECT isnt_empty($$ select 1 from public.artists where name='Imp1' and org_id='22222222-000b-4001-8001-000000000001' $$, 'producer bulk import allowed when add_artists on');

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-000b-4001-8001-000000000001','producer_can_add_artists',false);
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims','{"sub":"11111111-000b-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ select public.bulk_import_artists('22222222-000b-4001-8001-000000000001', '[{"name":"Imp2"}]'::jsonb) $$, '42501', NULL, 'producer bulk import denied when add_artists off');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"11111111-000b-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.bulk_import_artists('22222222-000b-4001-8001-000000000001', '[{"name":"Imp3"}]'::jsonb);
RESET ROLE;
SELECT isnt_empty($$ select 1 from public.artists where name='Imp3' and org_id='22222222-000b-4001-8001-000000000001' $$, 'admin bulk import always allowed');

SELECT * FROM finish();
ROLLBACK;
