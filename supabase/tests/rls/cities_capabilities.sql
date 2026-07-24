-- pgTAP: capability-aware write RLS on cities + cast_city_priority (Phase 1.5).
-- Producer INSERT/UPDATE cities and INSERT/UPDATE/DELETE cast_city_priority
-- gated on producer_can_manage_cities; cities DELETE admin-only; SELECT always.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0005-4001-8001-000000000001','authenticated','authenticated','ci-admin@t.com',now(),now()),
  ('11111111-0005-4001-8001-000000000002','authenticated','authenticated','ci-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0005-4001-8001-000000000001','CiOrg','ci-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0005-4001-8001-000000000001','11111111-0005-4001-8001-000000000001','admin'),
  ('22222222-0005-4001-8001-000000000001','11111111-0005-4001-8001-000000000002','producer');
INSERT INTO public.casts (id, name, org_id) VALUES ('55555555-0005-4001-8001-000000000001','Cast','22222222-0005-4001-8001-000000000001');
INSERT INTO public.cities (id, name, org_id) VALUES
  ('77777777-0005-4001-8001-000000000001','City One','22222222-0005-4001-8001-000000000001'),
  ('77777777-0005-4001-8001-000000000002','City Two','22222222-0005-4001-8001-000000000001'),
  ('77777777-0005-4001-8001-000000000003','City Three','22222222-0005-4001-8001-000000000001'),
  ('77777777-0005-4001-8001-000000000004','City Four','22222222-0005-4001-8001-000000000001');
INSERT INTO public.cast_city_priority (cast_id, city_id, priority, org_id) VALUES
  ('55555555-0005-4001-8001-000000000001','77777777-0005-4001-8001-000000000001',1,'22222222-0005-4001-8001-000000000001'),
  ('55555555-0005-4001-8001-000000000001','77777777-0005-4001-8001-000000000002',2,'22222222-0005-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (manage_cities on by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ insert into public.cities (name, org_id) values ('New City','22222222-0005-4001-8001-000000000001') $$, 'producer INSERT city allowed when manage on');
UPDATE public.cities SET airtable_city_key='on1' WHERE id='77777777-0005-4001-8001-000000000001';
SELECT is((SELECT airtable_city_key FROM public.cities WHERE id='77777777-0005-4001-8001-000000000001'), 'on1', 'producer UPDATE city applied when manage on');
SELECT lives_ok($$ insert into public.cast_city_priority (cast_id, city_id, priority, org_id) values ('55555555-0005-4001-8001-000000000001','77777777-0005-4001-8001-000000000003',3,'22222222-0005-4001-8001-000000000001') $$, 'producer INSERT ccp allowed when manage on');
UPDATE public.cast_city_priority SET priority=99 WHERE cast_id='55555555-0005-4001-8001-000000000001' AND city_id='77777777-0005-4001-8001-000000000001';
SELECT is((SELECT priority FROM public.cast_city_priority WHERE cast_id='55555555-0005-4001-8001-000000000001' AND city_id='77777777-0005-4001-8001-000000000001'), 99, 'producer UPDATE ccp applied when manage on');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-0005-4001-8001-000000000001','producer_can_manage_cities',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ insert into public.cities (name, org_id) values ('Blocked','22222222-0005-4001-8001-000000000001') $$, '42501', NULL, 'producer INSERT city denied when manage off');
SELECT throws_ok($$ insert into public.cast_city_priority (cast_id, city_id, priority, org_id) values ('55555555-0005-4001-8001-000000000001','77777777-0005-4001-8001-000000000004',4,'22222222-0005-4001-8001-000000000001') $$, '42501', NULL, 'producer INSERT ccp denied when manage off');
DELETE FROM public.cast_city_priority WHERE cast_id='55555555-0005-4001-8001-000000000001' AND city_id='77777777-0005-4001-8001-000000000002';
SELECT isnt_empty($$ select 1 from public.cast_city_priority where cast_id='55555555-0005-4001-8001-000000000001' and city_id='77777777-0005-4001-8001-000000000002' $$, 'producer DELETE ccp no-op when manage off');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.cities WHERE id='77777777-0005-4001-8001-000000000004';
SELECT is_empty($$ select 1 from public.cities where id='77777777-0005-4001-8001-000000000004' $$, 'admin DELETE city allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
