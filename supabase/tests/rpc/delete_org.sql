-- delete_org: super-admin only; removes the org + its audit log; leaves other
-- orgs and members' global profiles intact.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000ca0','authenticated','authenticated','super@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000ca1','authenticated','authenticated','plain@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('00000000-0000-0000-0000-000000000ca0');
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000cc0','Doomed','doomed-org'),
  ('00000000-0000-0000-0000-000000000cc1','Keeper','keeper-org');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-000000000ca1','Plain');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000cc0','00000000-0000-0000-0000-000000000ca1','artist');
INSERT INTO public.booking_audit_log (id, org_id, action) VALUES
  ('00000000-0000-0000-0000-000000000ce0','00000000-0000-0000-0000-000000000cc0','status_change');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000ca1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.delete_org('00000000-0000-0000-0000-000000000cc0') $$,
  '42501', NULL, 'non-super-admin cannot delete an org');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000ca0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.delete_org('00000000-0000-0000-0000-000000000cc0') $$, 'super-admin can delete an org');
RESET ROLE;

SELECT ok(NOT EXISTS(SELECT 1 FROM public.organizations WHERE id='00000000-0000-0000-0000-000000000cc0'), 'org row gone');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.booking_audit_log WHERE org_id='00000000-0000-0000-0000-000000000cc0'),
          'org audit log torn down');
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE user_id='00000000-0000-0000-0000-000000000ca1'),
          'member global profile retained');
SELECT ok(EXISTS(SELECT 1 FROM public.organizations WHERE id='00000000-0000-0000-0000-000000000cc1'),
          'a different org is left untouched');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.org_memberships WHERE org_id='00000000-0000-0000-0000-000000000cc0'),
          'deleted org memberships removed');

SELECT * FROM finish();
ROLLBACK;
