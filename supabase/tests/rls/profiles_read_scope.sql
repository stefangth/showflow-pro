-- Tests for the profiles SELECT policy after C2
-- (20260702120001_restrict_profiles_select_shared_org.sql).
--
-- Before C2, "Anyone authenticated can view profiles" USING (true) let any
-- authenticated user read display_name + phone of EVERY user on the platform
-- (cross-tenant PII leak). C2 replaces it with a policy that permits a SELECT only
-- when the row is the caller's own profile, OR the caller shares an org with the
-- target user, OR the caller is a super-admin.
--
-- Note on schema: public.profiles has a surrogate PK `id` distinct from `user_id`
-- (the auth.users FK). Org membership is keyed on the auth user, so the shared-org
-- check joins org_memberships on profiles.user_id (NOT profiles.id).
--
-- UUID legend (all test-only, rolled back at end; hex only):
--   aaaaaaaa-af00-0001-…  super-admin
--   aaaaaaaa-af00-0002-…  org-A user   (shares org A with 0003)
--   aaaaaaaa-af00-0003-…  org-A user
--   aaaaaaaa-af00-0004-…  org-B user   (only in org B — a stranger to org A)
--   00000000-…-0000af0a   org A         00000000-…-0000af0b   org B

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-af00-0001-0000-000000000000','authenticated','authenticated','pr-super@test.com', now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('aaaaaaaa-af00-0002-0000-000000000000','authenticated','authenticated','pr-a1@test.com',    now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('aaaaaaaa-af00-0003-0000-000000000000','authenticated','authenticated','pr-a2@test.com',    now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('aaaaaaaa-af00-0004-0000-000000000000','authenticated','authenticated','pr-b1@test.com',    now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000af0a','Org PA','pr-org-a'),
  ('00000000-0000-0000-0000-00000000af0b','Org PB','pr-org-b');

INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-af00-0001-0000-000000000000');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000af0a','aaaaaaaa-af00-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000af0a','aaaaaaaa-af00-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000af0b','aaaaaaaa-af00-0004-0000-000000000000','artist');

-- Profiles: id (surrogate) deliberately DIFFERENT from user_id so the test would fail
-- if the policy mistakenly joined on profiles.id instead of profiles.user_id.
INSERT INTO public.profiles (id, user_id, display_name, phone) VALUES
  ('11111111-af00-0001-0000-000000000000','aaaaaaaa-af00-0001-0000-000000000000','Super',  '+1000'),
  ('11111111-af00-0002-0000-000000000000','aaaaaaaa-af00-0002-0000-000000000000','A One',  '+1002'),
  ('11111111-af00-0003-0000-000000000000','aaaaaaaa-af00-0003-0000-000000000000','A Two',  '+1003'),
  ('11111111-af00-0004-0000-000000000000','aaaaaaaa-af00-0004-0000-000000000000','B One',  '+1004');

SET session_replication_role = DEFAULT;

-- ── As 0002 (org A). Can read self, can read co-org 0003, CANNOT read org-B 0004. ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-af00-0002-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE user_id = 'aaaaaaaa-af00-0002-0000-000000000000'),
  1, 'a user can always read their own profile');

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE user_id = 'aaaaaaaa-af00-0003-0000-000000000000'),
  1, 'a user can read a co-org member''s profile (name+phone still visible)');

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE user_id = 'aaaaaaaa-af00-0004-0000-000000000000'),
  0, 'a user CANNOT read a stranger''s profile in another org (cross-org SELECT returns 0 rows)');

-- The org-B user's phone must not be reachable via the profiles table at all.
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE phone = '+1004'),
  0, 'cross-org phone is not enumerable');

RESET ROLE;

-- ── As 0004 (org B). Only sees self; the two org-A users are strangers. ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-af00-0004-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.profiles
     WHERE user_id IN ('aaaaaaaa-af00-0002-0000-000000000000','aaaaaaaa-af00-0003-0000-000000000000')),
  0, 'org-B user cannot read org-A members'' profiles');

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE user_id = 'aaaaaaaa-af00-0004-0000-000000000000'),
  1, 'org-B user can read their own profile');

RESET ROLE;

-- ── As super-admin. Sees every profile (god-mode read retained). ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-af00-0001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.profiles
     WHERE user_id IN (
       'aaaaaaaa-af00-0001-0000-000000000000',
       'aaaaaaaa-af00-0002-0000-000000000000',
       'aaaaaaaa-af00-0003-0000-000000000000',
       'aaaaaaaa-af00-0004-0000-000000000000')),
  4, 'super-admin can read every profile across orgs');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
