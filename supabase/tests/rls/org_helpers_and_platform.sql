-- Phase 0: helper functions (is_super_admin / is_org_member / has_org_role) and
-- RLS on the platform tables (organizations, org_memberships, org_invitations).
--
-- UUID legend (test-only, rolled back):
--   aaaa…0001 super-admin      aaaa…0002 org-A admin
--   aaaa…0003 org-A artist     aaaa…0004 outsider (no membership)
--   0000…a000 org A            0000…b000 org B
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','ph-super@test.com',  now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000','authenticated','authenticated','ph-aadmin@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000','authenticated','authenticated','ph-aartist@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000','authenticated','authenticated','ph-out@test.com',    now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','Org A','ph-org-a'),
  ('00000000-0000-0000-0000-00000000b000','Org B','ph-org-b');

INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-0002-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-0003-0000-000000000000','artist');

SET session_replication_role = DEFAULT;

-- ── helper functions (called directly; they are SECURITY DEFINER) ──
SELECT ok(     public.is_super_admin('aaaaaaaa-aaaa-0001-0000-000000000000'),     'super-admin recognized');
SELECT ok( NOT public.is_super_admin('aaaaaaaa-aaaa-0002-0000-000000000000'),     'org-admin is not super-admin');
SELECT ok(     public.is_org_member('aaaaaaaa-aaaa-0003-0000-000000000000','00000000-0000-0000-0000-00000000a000'), 'artist is member of org A');
SELECT ok( NOT public.is_org_member('aaaaaaaa-aaaa-0003-0000-000000000000','00000000-0000-0000-0000-00000000b000'), 'artist is NOT member of org B');
SELECT ok(     public.is_org_member('aaaaaaaa-aaaa-0001-0000-000000000000','00000000-0000-0000-0000-00000000b000'), 'super-admin passes is_org_member for any org');
SELECT ok(     public.has_org_role('aaaaaaaa-aaaa-0002-0000-000000000000','00000000-0000-0000-0000-00000000a000','admin'),  'org-A admin has admin role in A');
SELECT ok( NOT public.has_org_role('aaaaaaaa-aaaa-0003-0000-000000000000','00000000-0000-0000-0000-00000000a000','admin'),  'org-A artist lacks admin role');

-- ── organizations RLS: members see their org; others do not ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.organizations WHERE id='00000000-0000-0000-0000-00000000a000'),1,'member sees own org');
SELECT is((SELECT count(*)::int FROM public.organizations WHERE id='00000000-0000-0000-0000-00000000b000'),0,'member cannot see other org');
RESET ROLE;

-- outsider (no membership) sees no org
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.organizations WHERE id='00000000-0000-0000-0000-00000000a000'),0,'outsider sees no org');
RESET ROLE;

-- ── org_invitations RLS: org-admin may invite within their org; artist may not ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.org_invitations (org_id, email, role, invited_by)
    VALUES ('00000000-0000-0000-0000-00000000a000','newprod@test.com','producer','aaaaaaaa-aaaa-0002-0000-000000000000')$$,
  'org-admin can create an invitation for their org');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.org_invitations (org_id, email, role, invited_by)
    VALUES ('00000000-0000-0000-0000-00000000a000','x@test.com','producer','aaaaaaaa-aaaa-0003-0000-000000000000')$$,
  '42501', null, 'artist cannot create an invitation');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
