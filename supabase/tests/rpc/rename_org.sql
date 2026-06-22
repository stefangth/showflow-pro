-- supabase/tests/rpc/rename_org.sql
-- rename_org: org admin renames their org (name only); non-admin rejected; slug untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000003a1','Old Name','rename-me');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000003a1','00000000-0000-0000-0000-0000000003ad','admin');
SET session_replication_role = DEFAULT;

-- non-admin rejected
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000003be","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.rename_org('00000000-0000-0000-0000-0000000003a1','Hacked') $$,
  '42501', NULL, 'non-admin cannot rename the org');
RESET ROLE;

-- admin: blank name rejected
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000003ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.rename_org('00000000-0000-0000-0000-0000000003a1','   ') $$,
  '22023', NULL, 'blank name is rejected');

-- admin: rename succeeds
SELECT lives_ok(
  $$ SELECT public.rename_org('00000000-0000-0000-0000-0000000003a1','New Name') $$,
  'org admin can rename the org');
RESET ROLE;

SELECT is(
  (SELECT name FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000003a1'),
  'New Name', 'name was updated');
SELECT is(
  (SELECT slug FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000003a1'),
  'rename-me', 'slug is unchanged');

SELECT * FROM finish();
ROLLBACK;
