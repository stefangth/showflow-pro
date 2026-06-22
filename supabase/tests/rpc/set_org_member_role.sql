-- supabase/tests/rpc/set_org_member_role.sql
-- set_org_member_role: admin adds/removes roles; non-admin rejected; last-admin guarded.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000005ad','authenticated','authenticated','admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000005b0','authenticated','authenticated','bob@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000005c0','Crew','crew-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005ad','admin'),
  ('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','producer');
SET session_replication_role = DEFAULT;

-- non-admin (bob) cannot change roles
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000005b0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','admin','add') $$,
  '42501', NULL, 'non-admin cannot change roles');
RESET ROLE;

-- admin adds 'artist' to bob
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000005ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','artist','add') $$,
  'admin can add a role');
SELECT ok(
  EXISTS (SELECT 1 FROM public.org_memberships
          WHERE org_id='00000000-0000-0000-0000-0000000005c0'
            AND user_id='00000000-0000-0000-0000-0000000005b0' AND role='artist'),
  'the artist role row exists');

-- admin cannot remove the last admin (themselves)
SELECT throws_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005ad','admin','remove') $$,
  '42501', NULL, 'cannot remove the last admin');

-- admin removes bob's producer role
SELECT lives_ok(
  $$ SELECT public.set_org_member_role('00000000-0000-0000-0000-0000000005c0','00000000-0000-0000-0000-0000000005b0','producer','remove') $$,
  'admin can remove a non-admin role');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
