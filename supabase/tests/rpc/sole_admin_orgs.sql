-- sole_admin_orgs: self-scoped — returns the caller's sole-admin orgs, but is empty
-- for a different (non-super-admin) caller passing someone else's id (info-disclosure guard).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a0','authenticated','authenticated','solo@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','nosy@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('00000000-0000-0000-0000-0000000000c0','Solo','solo-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000c0','00000000-0000-0000-0000-0000000000a0','admin');
SET session_replication_role = DEFAULT;

-- the sole admin sees their own org
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((select count(*)::int from public.sole_admin_orgs('00000000-0000-0000-0000-0000000000a0')),
          1, 'self sees own sole-admin org');
RESET ROLE;

-- a different, non-super-admin user gets nothing (no information disclosure)
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((select count(*)::int from public.sole_admin_orgs('00000000-0000-0000-0000-0000000000a0')),
          0, 'other user cannot enumerate someone else''s sole-admin orgs');
SELECT is((select count(*)::int from public.sole_admin_orgs('00000000-0000-0000-0000-0000000000a1')),
          0, 'nosy user is not a sole admin anywhere');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
