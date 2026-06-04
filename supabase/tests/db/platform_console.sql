-- Phase 4 platform RPCs: provision_org (atomic + super-admin only), platform_org_stats
-- (super-admin only), add/remove/list_platform_admin (last-admin + self-demote guards).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- ── Seed two auth users (super sA, normal sN) + a target user for add_platform_admin.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000a1','authenticated','authenticated','super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a2','authenticated','authenticated','normal@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a3','authenticated','authenticated','promote@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-0000-4000-a000-0000000000a1');
-- Deterministic starter template so seed counts are exact (overrides the migration seed).
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL,'starter_catalog_template','{"skills":["Vocals","Dance"],"cities":[],"casts":[{"name":"Main Cast","description":null}]}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
SET session_replication_role = DEFAULT;

-- Helper to act as a given uid.
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- ── provision_org: super-admin succeeds, atomically creating org + catalog + invite.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.provision_org('Acme Circus','acme','first-admin@acme.com')$$,
  'super-admin can provision an org');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.organizations WHERE slug='acme'),1,'org row created');
SELECT is((SELECT count(*)::int FROM public.skills s JOIN public.organizations o ON o.id=s.org_id WHERE o.slug='acme'),2,'starter skills seeded into org');
SELECT is((SELECT count(*)::int FROM public.org_invitations i JOIN public.organizations o ON o.id=i.org_id WHERE o.slug='acme' AND i.email='first-admin@acme.com' AND i.role='admin'),1,'first-admin invitation created');

-- ── provision_org: duplicate slug rejected (unique_violation).
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.provision_org('Acme Two','acme','x@acme.com')$$,
  '23505', NULL, 'duplicate slug is rejected');
RESET ROLE;

-- ── provision_org: non-super-admin forbidden.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.provision_org('Nope','nope','y@nope.com')$$,
  '42501', NULL, 'non-super-admin cannot provision');
RESET ROLE;

-- ── platform_org_stats: super-admin sees the org; non-super-admin is forbidden.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.platform_org_stats() WHERE slug='acme'),1,'super-admin sees org stats');
SELECT is((SELECT member_count FROM public.platform_org_stats() WHERE slug='acme'),0,'new org has 0 members');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.platform_org_stats()$$,'42501',NULL,'non-super-admin cannot read stats');
RESET ROLE;

-- ── add/remove/list_platform_admin guards.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.add_platform_admin('promote@test.com')$$,'super-admin can promote by email');
SELECT throws_ok($$SELECT public.remove_platform_admin('aaaaaaaa-0000-4000-a000-0000000000a1'::uuid)$$,
  '42501', NULL, 'cannot remove your own platform-admin access');
-- now there are 2 admins (a1, a3); removing the OTHER is allowed.
SELECT lives_ok($$SELECT public.remove_platform_admin('aaaaaaaa-0000-4000-a000-0000000000a3'::uuid)$$,'can remove a non-self admin when >1 remain');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
