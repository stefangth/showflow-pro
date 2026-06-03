-- RLS tests for the reference / config tables:
--   public.casts, public.cast_members, public.skills, public.artist_skills
--     → any authenticated user may SELECT; only admin/producer may write.
--   public.app_settings
--     → any authenticated user may SELECT; only ADMIN may write.
--
-- Policies under test (source migrations):
--   casts (20260421170151):
--     "Authenticated can view casts"               — SELECT, USING (true)
--     "Admins and producers can insert casts"      — INSERT, admin/producer
--     "Admins and producers can update casts"      — UPDATE, admin/producer
--     "Admins can delete casts"                    — DELETE, admin
--   cast_members (20260421170151):
--     "Authenticated can view cast members"        — SELECT, USING (true)
--     "Admins and producers can insert cast members" — INSERT, admin/producer
--     "Admins and producers can delete cast members" — DELETE, admin/producer
--   skills (20260514130000):
--     "skills_read_all"                            — SELECT, USING (true)
--     "skills_write_admin_or_producer"             — INSERT, admin/producer
--   artist_skills (20260514130000):
--     "artist_skills_read_all"                     — SELECT, USING (true)
--     "artist_skills_write_admin_or_producer"      — INSERT, admin/producer
--   app_settings (20260417102257):
--     "Authenticated users can view app settings"  — SELECT, USING (true)
--     "Admins can insert app settings"             — INSERT, admin only
--     "Admins can update app settings"             — UPDATE, admin only
--
-- UUID legend (all IDs are test-only, rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist user
--   bbbbbbbb-bbbb-0001-…  artist profile row
--   cccccccc-cccc-0001-…  cast
--   cccccccc-cccc-0002-…  skill (paired with artist in Test 9)
--   cccccccc-cccc-0003-…  skill (unpaired; used by artist-denied Test 11)
--   eeeeeeee-eeee-0001-…  cast_members row
--   eeeeeeee-eeee-0002-…  app_settings row

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup (as postgres superuser)
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-rt-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-rt-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-rt-artist@test.com',   now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'admin'::app_role),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'producer'::app_role),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'artist'::app_role);

-- Phase 1B: org-scoped role-gating — mirror roles as bootstrap-org memberships.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id) VALUES
  ('bbbbbbbb-bbbb-0001-0000-000000000000', 'RT Artist', 'aaaaaaaa-aaaa-0003-0000-000000000000');

INSERT INTO public.casts (id, name)
VALUES ('cccccccc-cccc-0001-0000-000000000000', 'RT Cast');

INSERT INTO public.skills (id, name)
VALUES
  ('cccccccc-cccc-0002-0000-000000000000', 'RT Skill'),
  ('cccccccc-cccc-0003-0000-000000000000', 'RT Skill 2');

INSERT INTO public.cast_members (id, cast_id, artist_id)
VALUES ('eeeeeeee-eeee-0001-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000');

INSERT INTO public.app_settings (id, key, value, description)
VALUES ('eeeeeeee-eeee-0002-0000-000000000000', 'rls_rt_test_key', '"v1"'::jsonb, 'reference_tables.sql test row');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- casts — authenticated SELECT; admin/producer write
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Artist can SELECT casts (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.casts
   WHERE id = 'cccccccc-cccc-0001-0000-000000000000'),
  1,
  'artist can SELECT casts'
);

RESET ROLE;

-- 2. Producer can INSERT a cast
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.casts (name) VALUES ('Producer Cast')$$,
  'producer can INSERT a cast'
);

RESET ROLE;

-- 3. Artist cannot INSERT a cast
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.casts (name) VALUES ('Artist Cast')$$,
  '42501',
  null,
  'artist cannot INSERT a cast'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- cast_members — authenticated SELECT; admin/producer write
-- ────────────────────────────────────────────────────────────────────────────

-- 4. Artist can SELECT cast_members (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.cast_members
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'artist can SELECT cast_members'
);

RESET ROLE;

-- 5. Artist cannot INSERT a cast_member
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.cast_members (cast_id, artist_id)
    VALUES ('cccccccc-cccc-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000')$$,
  '42501',
  null,
  'artist cannot INSERT a cast_member'
);

RESET ROLE;

-- 6. Producer can DELETE a cast_member
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM public.cast_members
WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.cast_members
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  0,
  'producer can DELETE a cast_member'
);

-- ────────────────────────────────────────────────────────────────────────────
-- skills — authenticated SELECT; admin/producer write
-- ────────────────────────────────────────────────────────────────────────────

-- 7. Artist can SELECT skills (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.skills
   WHERE id = 'cccccccc-cccc-0002-0000-000000000000'),
  1,
  'artist can SELECT skills'
);

RESET ROLE;

-- 8. Artist cannot INSERT a skill
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.skills (name) VALUES ('Artist Skill')$$,
  '42501',
  null,
  'artist cannot INSERT a skill'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- artist_skills — authenticated SELECT; admin/producer write
-- ────────────────────────────────────────────────────────────────────────────

-- 9. Producer can INSERT an artist_skill
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.artist_skills (artist_id, skill_id)
    VALUES ('bbbbbbbb-bbbb-0001-0000-000000000000', 'cccccccc-cccc-0002-0000-000000000000')$$,
  'producer can INSERT an artist_skill'
);

RESET ROLE;

-- 10. Artist can SELECT artist_skills (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.artist_skills
   WHERE artist_id = 'bbbbbbbb-bbbb-0001-0000-000000000000'
     AND skill_id  = 'cccccccc-cccc-0002-0000-000000000000'),
  1,
  'artist can SELECT artist_skills'
);

RESET ROLE;

-- 11. Artist cannot INSERT an artist_skill.
--     Uses skill cccccccc-cccc-0003 (not yet paired with this artist) so the only
--     possible failure is the RLS write policy — not the composite-PK unique
--     violation that would mask it if we reused the Test 9 pair. Asserts the
--     specific RLS-denial SQLSTATE 42501.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.artist_skills (artist_id, skill_id)
    VALUES ('bbbbbbbb-bbbb-0001-0000-000000000000', 'cccccccc-cccc-0003-0000-000000000000')$$,
  '42501',
  null,
  'artist cannot INSERT an artist_skill'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- app_settings — authenticated SELECT; ADMIN-only write (producer denied)
-- ────────────────────────────────────────────────────────────────────────────

-- 12. Artist can SELECT app_settings (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.app_settings
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'artist can SELECT app_settings'
);

RESET ROLE;

-- 13. Artist cannot INSERT app_settings (admin-only write)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.app_settings (key, value)
    VALUES ('rls_rt_artist_key', '"nope"'::jsonb)$$,
  '42501',
  null,
  'artist cannot INSERT app_settings (admin-only write)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
