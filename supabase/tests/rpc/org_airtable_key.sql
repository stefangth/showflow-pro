-- supabase/tests/rpc/org_airtable_key.sql
-- set_org_airtable_key: only an admin of the org may set; get_org_airtable_key
-- is not executable by `authenticated`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a17a', 'AirOrg', 'air-org');
-- a member who is an admin of the org
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a17a', '00000000-0000-0000-0000-0000000ad317', 'admin');
SET session_replication_role = DEFAULT;

-- getter must NOT be granted to authenticated
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.get_org_airtable_key(uuid)', 'EXECUTE'),
  'get_org_airtable_key is not executable by authenticated');

-- setter as the org admin succeeds
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000ad317","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_org_airtable_key('00000000-0000-0000-0000-00000000a17a', 'key_abc') $$,
  'org admin can set the org airtable key');
RESET ROLE;

-- setter as a non-member is rejected
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000beef","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_org_airtable_key('00000000-0000-0000-0000-00000000a17a', 'key_xyz') $$,
  'forbidden',
  'non-admin cannot set the org airtable key');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
