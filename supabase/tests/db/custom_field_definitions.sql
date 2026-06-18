-- custom_field_definitions: structural constraints (RLS enabled, org_isolation policy,
-- key/type CHECK, UNIQUE) AND behavioral authz — org-admin write, org-member read,
-- non-admin write denied, and cross-org isolation. Role simulation mirrors rls/org_isolation.sql.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0a01-0000-000000000000','authenticated','authenticated','cf-aadmin@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0a02-0000-000000000000','authenticated','authenticated','cf-aprod@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-0b02-0000-000000000000','authenticated','authenticated','cf-bprod@test.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000cfa00','CF A','cf-a'),
  ('00000000-0000-0000-0000-0000000cfb00','CF B','cf-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000cfa00','aaaaaaaa-aaaa-0a01-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-0000000cfa00','aaaaaaaa-aaaa-0a02-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-0000000cfb00','aaaaaaaa-aaaa-0b02-0000-000000000000','producer');

-- Seed one definition in org A (as superuser, bypassing RLS) for the read tests.
INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
  VALUES ('00000000-0000-0000-0000-0000000cfa00','seeded','Seeded','text','Seeded');

SET session_replication_role = DEFAULT;

-- ── Structural (run as table owner / superuser) ──
-- 1) RLS enabled
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.custom_field_definitions'::regclass),
  true, 'RLS is enabled on custom_field_definitions');
-- 2) org_isolation policy exists
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE tablename = 'custom_field_definitions' AND policyname = 'org_isolation'),
  1, 'org_isolation policy exists');
-- 3) key CHECK rejects an invalid slug
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('00000000-0000-0000-0000-0000000cfa00', 'Bad Key', 'X', 'text', 'X') $$,
  '23514', NULL, 'key CHECK rejects non-slug keys');
-- 4) type CHECK rejects an unknown type
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('00000000-0000-0000-0000-0000000cfa00', 'bogus', 'X', 'json', 'X') $$,
  '23514', NULL, 'type CHECK rejects unknown types');
-- 5) UNIQUE(org_id, entity, key) rejects a duplicate of the seeded row
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('00000000-0000-0000-0000-0000000cfa00', 'seeded', 'Dup', 'text', 'Y') $$,
  '23505', NULL, 'UNIQUE(org_id,entity,key) rejects duplicates');

-- ── Behavioral authz ──
-- Org-A ADMIN
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0a01-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- 6) admin can insert into own org
SELECT lives_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('00000000-0000-0000-0000-0000000cfa00','admin_made','Admin Made','number','Cap') $$,
  'org admin can insert a definition into own org');
-- 7) admin cannot insert into org B (restrictive WITH CHECK)
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('00000000-0000-0000-0000-0000000cfb00','x','X','text','X') $$,
  '42501', NULL, 'org A admin cannot insert into org B');
RESET ROLE;

-- Org-A PRODUCER (member, non-admin): can read, cannot write
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0a02-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- 8) member can read own org definitions (seeded + admin_made = 2)
SELECT is(
  (SELECT count(*)::int FROM public.custom_field_definitions
     WHERE org_id='00000000-0000-0000-0000-0000000cfa00'),
  2, 'org member (producer) can read own org definitions');
-- 9) member cannot insert (admin-only write policy)
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('00000000-0000-0000-0000-0000000cfa00','prod_made','X','text','X') $$,
  '42501', NULL, 'non-admin org member cannot insert a definition');
RESET ROLE;

-- Org-B PRODUCER: cannot see org A definitions
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0b02-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- 10) cross-org read blocked
SELECT is(
  (SELECT count(*)::int FROM public.custom_field_definitions
     WHERE org_id='00000000-0000-0000-0000-0000000cfa00'),
  0, 'org B member sees zero of org A definitions');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
