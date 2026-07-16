-- settings_audit_log: app_settings writes are audited; org admins can read their org's rows.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000ad01','authenticated','authenticated','audit-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-00000000ad02','authenticated','authenticated','audit-other@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000ac01','AuditOrgA','audit-org-a'),
  ('00000000-0000-0000-0000-00000000ac02','AuditOrgB','audit-org-b');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-00000000ad01','admin'),
  ('00000000-0000-0000-0000-00000000ac02','00000000-0000-0000-0000-00000000ad02','admin');
SET session_replication_role = DEFAULT;

-- 1. INSERT into app_settings writes an audit row with old_value NULL
INSERT INTO public.app_settings (org_id, key, value)
VALUES ('00000000-0000-0000-0000-00000000ac01','booking_flow','{"artist_acceptance":true}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow' AND old_value IS NULL),
  1, 'insert audited with old_value NULL');

-- 2. UPDATE with a changed value writes a row carrying old and new
UPDATE public.app_settings SET value='{"artist_acceptance":false}'::jsonb
WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow';
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow'
     AND old_value='{"artist_acceptance":true}'::jsonb
     AND new_value='{"artist_acceptance":false}'::jsonb),
  1, 'update audited with old and new values');

-- 3. UPDATE with an identical value writes nothing
UPDATE public.app_settings SET value='{"artist_acceptance":false}'::jsonb
WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow';
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow'),
  2, 'no-op update not audited');

-- 4. org admin can read own org rows
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01'),
  2, 'org admin reads own org audit rows');
RESET ROLE;

-- 5. other-org admin sees nothing
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000ad02","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01'),
  0, 'foreign org admin sees no audit rows');

-- 6. authenticated users cannot write the audit log directly
SELECT throws_ok(
  $$INSERT INTO public.settings_audit_log (org_id, key, new_value)
    VALUES ('00000000-0000-0000-0000-00000000ac02','x','{}'::jsonb)$$,
  '42501', NULL, 'direct insert denied by RLS');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
