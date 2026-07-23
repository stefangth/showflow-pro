-- pgTAP: capability-aware write RLS on app_settings (Plan 3, Phase 1.8).
-- A producer may write a setting only when app_setting_capability(key) is enabled
-- for the org; unmapped (admin-only) keys are always producer-denied; admin always;
-- SELECT always (read-only floor). edit_booking_settings defaults OFF.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0008-4001-8001-000000000001','authenticated','authenticated','as-admin@t.com',now(),now()),
  ('11111111-0008-4001-8001-000000000002','authenticated','authenticated','as-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0008-4001-8001-000000000001','AsOrg','as-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0008-4001-8001-000000000001','11111111-0008-4001-8001-000000000001','admin'),
  ('22222222-0008-4001-8001-000000000001','11111111-0008-4001-8001-000000000002','producer');
INSERT INTO public.app_settings (key, value, org_id) VALUES
  ('offer_response_window_hours', '48'::jsonb, '22222222-0008-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (edit_booking_settings OFF by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0008-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ insert into public.app_settings (key, value, org_id) values ('confirmation_digest_hour_berlin','20'::jsonb,'22222222-0008-4001-8001-000000000001') $$, '42501', NULL, 'producer INSERT booking setting denied when edit off (default)');
SELECT throws_ok($$ insert into public.app_settings (key, value, org_id) values ('editor_column_templates','{}'::jsonb,'22222222-0008-4001-8001-000000000001') $$, '42501', NULL, 'producer INSERT admin-only key always denied');
SELECT isnt_empty($$ select 1 from public.app_settings where org_id='22222222-0008-4001-8001-000000000001' $$, 'producer SELECT always works');
RESET ROLE;

-- Enable edit_booking_settings.
SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-0008-4001-8001-000000000001','producer_can_edit_booking_settings',true);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0008-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.app_settings SET value='99'::jsonb WHERE key='offer_response_window_hours' AND org_id='22222222-0008-4001-8001-000000000001';
SELECT is((SELECT value::text FROM public.app_settings WHERE key='offer_response_window_hours' AND org_id='22222222-0008-4001-8001-000000000001'), '99', 'producer UPDATE booking setting applied when edit on');
SELECT lives_ok($$ insert into public.app_settings (key, value, org_id) values ('offer_digest_hour_berlin','19'::jsonb,'22222222-0008-4001-8001-000000000001') $$, 'producer INSERT booking setting allowed when edit on');
SELECT throws_ok($$ insert into public.app_settings (key, value, org_id) values ('starter_catalog_template','{}'::jsonb,'22222222-0008-4001-8001-000000000001') $$, '42501', NULL, 'producer INSERT admin-only key still denied when a cap is on');
RESET ROLE;

-- Admin always.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0008-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ insert into public.app_settings (key, value, org_id) values ('editor_column_templates','{}'::jsonb,'22222222-0008-4001-8001-000000000001') $$, 'admin INSERT admin-only key allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
