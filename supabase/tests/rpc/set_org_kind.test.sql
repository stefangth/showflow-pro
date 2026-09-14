-- set_org_kind: admin sets; non-admin rejected; unknown kind rejected by CHECK; set_at stamped.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000006ad','authenticated','authenticated','kind-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000006b0','authenticated','authenticated','kind-bob@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000006c0','Kind Org','kind-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000006c0','00000000-0000-0000-0000-0000000006ad','admin'),
  ('00000000-0000-0000-0000-0000000006c0','00000000-0000-0000-0000-0000000006b0','producer');
SET session_replication_role = DEFAULT;

-- default state
SELECT is((SELECT org_kind FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), 'production', 'defaults to production');
SELECT is((SELECT org_kind_set_at FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), NULL, 'set_at is null until chosen');

-- CHECK constraint
SELECT throws_ok(
  $$ UPDATE public.organizations SET org_kind='circus' WHERE id='00000000-0000-0000-0000-0000000006c0' $$,
  '23514', NULL, 'unknown kind rejected by CHECK');

-- non-admin (bob) cannot set
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000006b0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.set_org_kind('00000000-0000-0000-0000-0000000006c0','staffing') $$,
  '42501', NULL, 'non-admin cannot set org_kind');
RESET ROLE;

-- admin sets staffing
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.set_org_kind('00000000-0000-0000-0000-0000000006c0','staffing') $$,
  'admin can set org_kind');
RESET ROLE;
SELECT is((SELECT org_kind FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), 'staffing', 'org_kind updated');
SELECT isnt((SELECT org_kind_set_at FROM public.organizations WHERE id='00000000-0000-0000-0000-0000000006c0'), NULL, 'set_at stamped');

SELECT * FROM finish();
ROLLBACK;
