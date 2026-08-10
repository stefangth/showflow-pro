-- public.list_org_admin_names(p_org): member-guarded; returns the distinct
-- display_name of every 'admin' role member of p_org (producer-safe, so a
-- producer can name-drop "who to ask" without an admin-only RPC). Excludes
-- non-admin roles, other orgs' admins, and admins with no (or blank) display
-- name. Rejects non-members with 42501; anon cannot execute.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('22222222-3333-4444-0002-000000000001','authenticated','authenticated','nadia-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('22222222-3333-4444-0002-000000000002','authenticated','authenticated','noname-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('22222222-3333-4444-0002-000000000003','authenticated','authenticated','producer-a@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('22222222-3333-4444-0002-000000000004','authenticated','authenticated','other-org-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('22222222-3333-4444-0002-000000000005','authenticated','authenticated','outsider@x.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-3333-4444-0001-000000000001','Admin Names Org A','admin-names-org-a'),
  ('22222222-3333-4444-0001-000000000002','Admin Names Org B','admin-names-org-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-3333-4444-0001-000000000001','22222222-3333-4444-0002-000000000001','admin'),
  ('22222222-3333-4444-0001-000000000001','22222222-3333-4444-0002-000000000002','admin'),
  ('22222222-3333-4444-0001-000000000001','22222222-3333-4444-0002-000000000003','producer'),
  ('22222222-3333-4444-0001-000000000002','22222222-3333-4444-0002-000000000004','admin');

-- Org A: Nadia (named admin), a second admin with NO display name (must be
-- omitted), and a producer (must be omitted -- wrong role). Org B: an admin
-- with a real name (must never leak into org A's result).
INSERT INTO public.profiles (user_id, display_name) VALUES
  ('22222222-3333-4444-0002-000000000001','Nadia Okonkwo'),
  ('22222222-3333-4444-0002-000000000002', NULL),
  ('22222222-3333-4444-0002-000000000003','Producer Persson'),
  ('22222222-3333-4444-0002-000000000004','Other Org Admin');
SET session_replication_role = DEFAULT;

-- 1. Called as the producer (a member, not an admin): returns exactly
--    {'Nadia Okonkwo'} -- not the other org's admin, not the producer itself,
--    and not the null-display-name admin.
SELECT pg_temp.act_as('22222222-3333-4444-0002-000000000003');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT array_agg(t) FROM public.list_org_admin_names('22222222-3333-4444-0001-000000000001') AS t),
  ARRAY['Nadia Okonkwo'],
  'producer sees exactly the named org admin, excluding the other org, the producer role, and the null-name admin');
RESET ROLE;

-- 2. Called as the org-A admin herself: same result (self-inclusive).
SELECT pg_temp.act_as('22222222-3333-4444-0002-000000000001');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT array_agg(t) FROM public.list_org_admin_names('22222222-3333-4444-0001-000000000001') AS t),
  ARRAY['Nadia Okonkwo'],
  'an admin calling it sees the same list');
RESET ROLE;

-- 3. Called as a non-member of org A: rejected with 42501.
SELECT pg_temp.act_as('22222222-3333-4444-0002-000000000005');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.list_org_admin_names('22222222-3333-4444-0001-000000000001') $$,
  '42501', NULL, 'a non-member is rejected');
RESET ROLE;

-- 4. Org B's own admin sees only their own org's admin.
SELECT pg_temp.act_as('22222222-3333-4444-0002-000000000004');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT array_agg(t) FROM public.list_org_admin_names('22222222-3333-4444-0001-000000000002') AS t),
  ARRAY['Other Org Admin'],
  'org B sees its own admin only');
RESET ROLE;

-- 5. anon has no execute privilege.
SELECT is(
  has_function_privilege('anon','public.list_org_admin_names(uuid)','execute'),
  false, 'anon cannot execute the RPC');

SELECT * FROM finish();
ROLLBACK;
