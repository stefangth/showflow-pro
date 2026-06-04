-- seed_org_starter_catalog copies the platform starter template into ONE org's catalog;
-- per-org name uniqueness lets two orgs share a name; the seed is idempotent.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000ca000','Cat A','cat-a'),
  ('00000000-0000-0000-0000-0000000cb000','Cat B','cat-b');
-- Platform starter template + slot defaults. The 2D migration ALREADY seeds a
-- starter_catalog_template platform row, so UPSERT to override it with this test's
-- deterministic 2-skill template (keeps the count assertions below exact). Unique is
-- (org_id,key) NULLS NOT DISTINCT, so a plain INSERT of (NULL,'starter_catalog_template')
-- would 23505 against the migration's seed.
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'starter_catalog_template',
   '{"skills":["Vocals","Dance"],"cities":[],"casts":[{"name":"Main Cast","description":null}]}'::jsonb),
  (NULL, 'sub_program_slots_defaults', '{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
SET session_replication_role = DEFAULT;

SELECT public.seed_org_starter_catalog('00000000-0000-0000-0000-0000000ca000');
SELECT public.seed_org_starter_catalog('00000000-0000-0000-0000-0000000cb000');
-- idempotent: a second call adds nothing
SELECT public.seed_org_starter_catalog('00000000-0000-0000-0000-0000000ca000');

SELECT is((SELECT count(*)::int FROM public.skills WHERE org_id='00000000-0000-0000-0000-0000000ca000'),2,'org A seeded 2 skills');
SELECT is((SELECT count(*)::int FROM public.skills WHERE org_id='00000000-0000-0000-0000-0000000ca000' AND name='Vocals'),1,'idempotent: still one Vocals in org A');
SELECT is((SELECT count(*)::int FROM public.casts WHERE org_id='00000000-0000-0000-0000-0000000ca000' AND name='Main Cast'),1,'org A seeded Main Cast');
-- both orgs can hold the SAME skill name (per-org uniqueness)
SELECT is((SELECT count(*)::int FROM public.skills WHERE name='Vocals'),2,'Vocals exists in BOTH orgs');
-- per-org slot defaults seeded for org A (a copy of the platform default)
SELECT is( public.get_org_setting('00000000-0000-0000-0000-0000000ca000','sub_program_slots_defaults')
             -> 'theatre' -> 'musical' ->> 'main_cast', '1', 'org A got its own slot defaults');
-- per-org name uniqueness rejects a duplicate WITHIN an org…
SELECT throws_ok(
  $$INSERT INTO public.skills (org_id, name) VALUES ('00000000-0000-0000-0000-0000000ca000','Vocals')$$,
  '23505', NULL, 'duplicate skill name within an org is rejected');
-- …but artists uniqueness is per (org,user): same user can be an artist in both orgs
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-0c01-0000-000000000000','authenticated','authenticated','cu1@test.com',now(),'{"provider":"email"}','{}',now(),now());
SET session_replication_role = DEFAULT;
SELECT lives_ok(
  $$INSERT INTO public.artists (org_id, user_id, name) VALUES
      ('00000000-0000-0000-0000-0000000ca000','aaaaaaaa-aaaa-0c01-0000-000000000000','A'),
      ('00000000-0000-0000-0000-0000000cb000','aaaaaaaa-aaaa-0c01-0000-000000000000','A')$$,
  'same user can be an artist in two orgs');

SELECT * FROM finish();
ROLLBACK;
