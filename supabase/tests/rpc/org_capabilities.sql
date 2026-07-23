-- Tests for org_capabilities: the is_capability_enabled twin, stamp/audit triggers, and RLS.
--   aaaa…0001 super-admin     aaaa…0003 org member (producer, NOT super-admin)
--   bbbb…0001 org
-- Super-admins pass is_org_member() for any org (it short-circuits on is_super_admin),
-- so the RESTRICTIVE org_isolation policy does not block their writes.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('aaaa0000-0000-0000-0000-000000000001','authenticated','authenticated','sa@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000003','authenticated','authenticated','member@test.com',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaa0000-0000-0000-0000-000000000001');
INSERT INTO public.organizations (id, name, slug) VALUES ('bbbb0000-0000-0000-0000-000000000001','Org','cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer');
SET session_replication_role = DEFAULT;

-- Act as the super-admin.
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

-- 1. Registry default: no row → producer_can_invite is off.
SELECT is(
  public.is_capability_enabled('bbbb0000-0000-0000-0000-000000000001','producer_can_invite'),
  false, 'default (no row) is off');

-- 2. Super-admin can insert a capability row.
SELECT lives_ok(
  $$ INSERT INTO public.org_capabilities (org_id, capability, enabled)
     VALUES ('bbbb0000-0000-0000-0000-000000000001','producer_can_invite', true) $$,
  'super-admin inserts a capability row');

-- 3. is_capability_enabled reflects the enabled row.
SELECT is(
  public.is_capability_enabled('bbbb0000-0000-0000-0000-000000000001','producer_can_invite'),
  true, 'enabled row resolves to true');

-- 4. The stamp trigger recorded the acting super-admin.
SELECT is(
  (SELECT updated_by FROM public.org_capabilities
     WHERE org_id='bbbb0000-0000-0000-0000-000000000001' AND capability='producer_can_invite'),
  'aaaa0000-0000-0000-0000-000000000001'::uuid, 'stamp trigger set updated_by');

-- 5. The audit trigger wrote a settings_audit_log row.
SELECT isnt_empty(
  $$ SELECT 1 FROM public.settings_audit_log
       WHERE org_id='bbbb0000-0000-0000-0000-000000000001'
         AND key='capability:producer_can_invite' $$,
  'audit row written on insert');

-- Update to disabled; is_capability_enabled follows.
UPDATE public.org_capabilities SET enabled = false
  WHERE org_id='bbbb0000-0000-0000-0000-000000000001' AND capability='producer_can_invite';
-- 6.
SELECT is(
  public.is_capability_enabled('bbbb0000-0000-0000-0000-000000000001','producer_can_invite'),
  false, 'disabled row resolves to false');
RESET ROLE;

-- Act as a non-super-admin org member (producer).
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

-- 7. A non-super-admin cannot write org_capabilities (no permissive write policy → RLS denies).
SELECT throws_ok(
  $$ INSERT INTO public.org_capabilities (org_id, capability, enabled)
     VALUES ('bbbb0000-0000-0000-0000-000000000001','some_future_cap', true) $$,
  '42501', null, 'non-super-admin cannot insert a capability');

-- 8. A member CAN read the org's capability rows.
SELECT isnt_empty(
  $$ SELECT 1 FROM public.org_capabilities
       WHERE org_id='bbbb0000-0000-0000-0000-000000000001' AND capability='producer_can_invite' $$,
  'org member can read capability rows');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
