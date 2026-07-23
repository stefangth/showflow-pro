-- Tests for the platform_* super-admin RPCs (membership + artist link).
--   aaaa…0001 super-admin        aaaa…0002 org admin        aaaa…0003 regular user
--   bbbb…0001 org
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('aaaa0000-0000-0000-0000-000000000001','authenticated','authenticated','sa@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000002','authenticated','authenticated','admin@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000003','authenticated','authenticated','reg@test.com',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaa0000-0000-0000-0000-000000000001');
INSERT INTO public.organizations (id, name, slug) VALUES ('bbbb0000-0000-0000-0000-000000000001','Org','pm-org');
INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','admin');
SET session_replication_role = DEFAULT;

-- non-super-admin is rejected
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer','add') $$,
  '42501', null, 'non-super-admin cannot set membership');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- super-admin adds a producer role
SELECT lives_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer','add') $$,
  'super-admin adds a role');
SELECT isnt_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE user_id='aaaa0000-0000-0000-0000-000000000003' AND role='producer' $$,
  'producer role present');
-- removing the only admin is blocked
SELECT throws_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','admin','remove') $$,
  'P0001', null, 'cannot remove the last admin');
-- remove_membership on non-admin succeeds
SELECT lives_ok(
  $$ SELECT public.platform_remove_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003') $$,
  'super-admin removes a non-admin member');
SELECT is_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE user_id='aaaa0000-0000-0000-0000-000000000003' AND org_id='bbbb0000-0000-0000-0000-000000000001' $$,
  'member removed from org');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
