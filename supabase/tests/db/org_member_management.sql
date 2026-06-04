-- Phase 5: org member management RPC guards.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- Seed one org + users: org A has admin a1 + admin a2 + producer d1; s1 is a platform super-admin.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('bbbbbbbb-0000-4000-a000-0000000000a1','authenticated','authenticated','a1@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-0000-4000-a000-0000000000a2','authenticated','authenticated','a2@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-0000-4000-a000-0000000000d1','authenticated','authenticated','d1@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-0000-4000-a000-0000000000e1','authenticated','authenticated','s1@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug)
VALUES ('bbbbbbbb-0000-4000-0000-00000000a000','Org A','org-a-phase5');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a1','admin'),
  ('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a2','admin'),
  ('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000d1','producer');
INSERT INTO public.platform_admins (user_id) VALUES ('bbbbbbbb-0000-4000-a000-0000000000e1');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- 1. list_org_members: an admin sees all 3 members.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.list_org_members('bbbbbbbb-0000-4000-0000-00000000a000')),3,'admin lists 3 members');
RESET ROLE;

-- 2 & 3. a non-admin (producer) can neither list nor remove.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.list_org_members('bbbbbbbb-0000-4000-0000-00000000a000')$$,'42501',NULL,'non-admin cannot list members');
SELECT throws_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a2'::uuid)$$,'42501',NULL,'non-admin cannot remove members');
RESET ROLE;

-- 4 & 5. admin removes the producer.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000d1'::uuid)$$,'admin removes a producer');
SELECT is((SELECT count(*)::int FROM public.org_memberships WHERE org_id='bbbbbbbb-0000-4000-0000-00000000a000' AND user_id='bbbbbbbb-0000-4000-a000-0000000000d1'),0,'producer membership deleted');

-- 6. self-removal blocked.
SELECT throws_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a1'::uuid)$$,'42501',NULL,'cannot remove own membership');
RESET ROLE;

-- 7 & 8. a super-admin can remove a co-admin, but NOT the org's last admin.
SELECT pg_temp.act_as('bbbbbbbb-0000-4000-a000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a2'::uuid)$$,'super-admin removes a co-admin while another remains');
SELECT throws_ok($$SELECT public.remove_org_member('bbbbbbbb-0000-4000-0000-00000000a000','bbbbbbbb-0000-4000-a000-0000000000a1'::uuid)$$,'42501',NULL,'cannot remove the last admin of the org');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
