-- Per-org app_settings: platform default (org_id IS NULL) is readable by any member,
-- a per-org row overrides it, members cannot WRITE platform rows, super-admin can,
-- get_org_setting() resolves org ?? platform, and the (org_id,key) unique allows the
-- same key across orgs + one platform row.
--
--   aaaa…0001 super-admin   aaaa…00a2 org-A admin   aaaa…00b2 org-B admin
--   0000…a000 org A         0000…b000 org B
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','s-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00a2-0000-000000000000','authenticated','authenticated','s-aadmin@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00b2-0000-000000000000','authenticated','authenticated','s-badmin@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','S A','s-a'),
  ('00000000-0000-0000-0000-00000000b000','S B','s-b');
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-00a2-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b000','aaaaaaaa-aaaa-00b2-0000-000000000000','admin');

-- platform default + an org-A override of the same key
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'demo_key', '"platform"'::jsonb),
  ('00000000-0000-0000-0000-00000000a000', 'demo_key', '"orgA"'::jsonb);
SET session_replication_role = DEFAULT;

-- get_org_setting resolves org override, else platform, else null (definer; call directly)
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000a000','demo_key'), '"orgA"'::jsonb, 'org A override wins');
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000b000','demo_key'), '"platform"'::jsonb, 'org B falls back to platform default');
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000b000','missing'), NULL, 'unknown key resolves to null');

-- ── reads under RLS ──
-- org-B admin sees the platform row (org_id IS NULL) and NOT org A's override
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00b2-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.app_settings WHERE key='demo_key' AND org_id IS NULL),1,'member reads platform default');
SELECT is((SELECT count(*)::int FROM public.app_settings WHERE key='demo_key' AND org_id='00000000-0000-0000-0000-00000000a000'),0,'member cannot read another org override');
-- write-side: member admin cannot create a platform (NULL) row
SELECT throws_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES (NULL,'sneak','"x"'::jsonb)$$,
  '42501', NULL, 'member admin cannot write a platform default');
-- member admin CAN upsert their own org row
SELECT lives_ok(
  $$INSERT INTO public.app_settings (org_id, key, value)
    VALUES ('00000000-0000-0000-0000-00000000b000','demo_key','"orgB"'::jsonb)
    ON CONFLICT (org_id, key) DO UPDATE SET value=EXCLUDED.value$$,
  'member admin upserts own org setting');
RESET ROLE;

-- super-admin CAN write a platform default
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES (NULL,'plat2','"y"'::jsonb)$$,
  'super-admin writes a platform default');
RESET ROLE;

-- ── uniqueness ──
-- same key allowed across two different orgs + the platform row (3 rows total).
-- NOTE: count(DISTINCT org_id) would ignore the NULL row — count rows instead.
SELECT is((SELECT count(*)::int FROM public.app_settings WHERE key='demo_key'),3,'demo_key exists for NULL, org A, org B');
-- duplicate platform row for a key is rejected (NULLS NOT DISTINCT)
SELECT throws_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES (NULL,'demo_key','"dup"'::jsonb)$$,
  '23505', NULL, 'duplicate platform row for a key is rejected');
-- duplicate per-org row for a key is rejected
SELECT throws_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES ('00000000-0000-0000-0000-00000000a000','demo_key','"dup"'::jsonb)$$,
  '23505', NULL, 'duplicate per-org row for a key is rejected');

SELECT * FROM finish();
ROLLBACK;
