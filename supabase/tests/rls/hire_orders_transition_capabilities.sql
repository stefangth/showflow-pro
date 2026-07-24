-- pgTAP: transition-gated write RLS on hire_orders (Plan 3, Phase 1.9c).
-- Producer void requires producer_can_void_hire_orders; producer countersign
-- requires producer_can_manage_countersign; other producer writes + reads
-- unaffected; module gate preserved; admin always. hire_orders entitlement on.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-000a-4001-8001-000000000001','authenticated','authenticated','ho-admin@t.com',now(),now()),
  ('11111111-000a-4001-8001-000000000002','authenticated','authenticated','ho-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-000a-4001-8001-000000000001','HoOrg','ho-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-000a-4001-8001-000000000001','11111111-000a-4001-8001-000000000001','admin'),
  ('22222222-000a-4001-8001-000000000001','11111111-000a-4001-8001-000000000002','producer');
INSERT INTO public.org_entitlements (org_id, feature, enabled) VALUES ('22222222-000a-4001-8001-000000000001','hire_orders',true);
INSERT INTO public.hire_orders (id, org_id, order_no, data, status) VALUES
  ('aaaa000a-4001-8001-8001-000000000001','22222222-000a-4001-8001-000000000001','HO-1','{}'::jsonb,'issued'),
  ('aaaa000a-4001-8001-8001-000000000002','22222222-000a-4001-8001-000000000001','HO-2','{}'::jsonb,'issued'),
  ('aaaa000a-4001-8001-8001-000000000003','22222222-000a-4001-8001-000000000001','HO-3','{}'::jsonb,'draft'),
  ('aaaa000a-4001-8001-8001-000000000004','22222222-000a-4001-8001-000000000001','HO-4','{}'::jsonb,'issued'),
  ('aaaa000a-4001-8001-8001-000000000005','22222222-000a-4001-8001-000000000001','HO-5','{}'::jsonb,'issued'),
  ('aaaa000a-4001-8001-8001-000000000006','22222222-000a-4001-8001-000000000001','HO-6','{}'::jsonb,'draft'),
  ('aaaa000a-4001-8001-8001-000000000007','22222222-000a-4001-8001-000000000001','HO-7','{}'::jsonb,'issued');
SET session_replication_role = DEFAULT;

-- Producer (void + countersign caps on by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-000a-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.hire_orders SET status='void' WHERE id='aaaa000a-4001-8001-8001-000000000001';
SELECT is((SELECT status::text FROM public.hire_orders WHERE id='aaaa000a-4001-8001-8001-000000000001'), 'void', 'producer void allowed when void cap on');
UPDATE public.hire_orders SET status='countersigned' WHERE id='aaaa000a-4001-8001-8001-000000000002';
SELECT is((SELECT status::text FROM public.hire_orders WHERE id='aaaa000a-4001-8001-8001-000000000002'), 'countersigned', 'producer countersign allowed when countersign cap on');
UPDATE public.hire_orders SET order_no='HO-3b' WHERE id='aaaa000a-4001-8001-8001-000000000003';
SELECT is((SELECT order_no FROM public.hire_orders WHERE id='aaaa000a-4001-8001-8001-000000000003'), 'HO-3b', 'producer edit draft field allowed (no gated transition)');
SELECT isnt_empty($$ select 1 from public.hire_orders where org_id='22222222-000a-4001-8001-000000000001' $$, 'producer SELECT hire_orders always works');
RESET ROLE;

-- Disable void + countersign caps.
SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES
  ('22222222-000a-4001-8001-000000000001','producer_can_void_hire_orders',false),
  ('22222222-000a-4001-8001-000000000001','producer_can_manage_countersign',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-000a-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ update public.hire_orders set status='void' where id='aaaa000a-4001-8001-8001-000000000004' $$, '42501', NULL, 'producer void denied when void cap off');
SELECT throws_ok($$ update public.hire_orders set status='countersigned' where id='aaaa000a-4001-8001-8001-000000000005' $$, '42501', NULL, 'producer countersign denied when countersign cap off');
UPDATE public.hire_orders SET order_no='HO-6b' WHERE id='aaaa000a-4001-8001-8001-000000000006';
SELECT is((SELECT order_no FROM public.hire_orders WHERE id='aaaa000a-4001-8001-8001-000000000006'), 'HO-6b', 'producer edit draft still allowed when transition caps off');
RESET ROLE;

-- Admin always.
SELECT set_config('request.jwt.claims','{"sub":"11111111-000a-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.hire_orders SET status='void' WHERE id='aaaa000a-4001-8001-8001-000000000007';
SELECT is((SELECT status::text FROM public.hire_orders WHERE id='aaaa000a-4001-8001-8001-000000000007'), 'void', 'admin void always allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
