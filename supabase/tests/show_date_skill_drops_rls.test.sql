-- Per-date skill drops (offers cockpit phase C0): the show_date_skill_drops table,
-- its org derivation + same-org guard + org-isolation RLS + unique.
-- See migration 20260812190000_show_date_skill_drops.sql.
--
-- UUID legend (all test-only, rolled back at the end):
--   d40b0000-…-000a  org A          d40b0000-…-000b  org B
--   d40b0000-…-0a01  org A admin user
--   d40b0000-…-0c1a  city (org A)   d40b0000-…-05a  show (org A)   …-0d1a  date (org A)
--   d40b0000-…-05b  show (org B)    …-0d1b  date (org B)
--   d40b0000-…-0541  skill (org A)  …-0542  skill (org B)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

-- ── Fixture (as postgres superuser; triggers off so we can seed org_id freely) ──
SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d40b0000-0000-0000-0000-000000000a01', 'authenticated', 'authenticated', 'sd-drop-admin@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('d40b0000-0000-0000-0000-00000000000a', 'Drop Org A', 'drop-org-a'),
  ('d40b0000-0000-0000-0000-00000000000b', 'Drop Org B', 'drop-org-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('d40b0000-0000-0000-0000-00000000000a', 'd40b0000-0000-0000-0000-000000000a01', 'admin');

INSERT INTO public.cities (id, org_id, name) VALUES
  ('d40b0000-0000-0000-0000-0000000000c1', 'd40b0000-0000-0000-0000-00000000000a', 'Berlin');

INSERT INTO public.shows (id, org_id, program) VALUES
  ('d40b0000-0000-0000-0000-0000000005a0', 'd40b0000-0000-0000-0000-00000000000a', 'Show A'),
  ('d40b0000-0000-0000-0000-0000000005b0', 'd40b0000-0000-0000-0000-00000000000b', 'Show B');

INSERT INTO public.show_dates (id, org_id, show_id, city_id, date, session_1) VALUES
  ('d40b0000-0000-0000-0000-00000000d1a0', 'd40b0000-0000-0000-0000-00000000000a',
   'd40b0000-0000-0000-0000-0000000005a0', 'd40b0000-0000-0000-0000-0000000000c1', '2027-01-15', '19:00'),
  ('d40b0000-0000-0000-0000-00000000d1b0', 'd40b0000-0000-0000-0000-00000000000b',
   'd40b0000-0000-0000-0000-0000000005b0', NULL, '2027-01-16', '19:00');

INSERT INTO public.skills (id, org_id, name) VALUES
  ('d40b0000-0000-0000-0000-000000000541', 'd40b0000-0000-0000-0000-00000000000a', 'German'),
  ('d40b0000-0000-0000-0000-000000000542', 'd40b0000-0000-0000-0000-00000000000b', 'foreign');

SET session_replication_role = DEFAULT;

-- 1: RLS is enabled on the table
SELECT is(
  (SELECT count(*) FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'show_date_skill_drops' AND rowsecurity),
  1::bigint, 'RLS enabled on show_date_skill_drops');

-- Act as the org A admin for the write-path tests.
SELECT set_config('request.jwt.claims', '{"sub":"d40b0000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- 2: an org A member can INSERT a drop for a show_date in org A, with NO org_id
--    (the derive trigger fills it before the NOT NULL / RLS checks).
SELECT lives_ok($$
  INSERT INTO public.show_date_skill_drops (show_date_id, skill_id)
  VALUES ('d40b0000-0000-0000-0000-00000000d1a0', 'd40b0000-0000-0000-0000-000000000541')
$$, 'org A admin drops an org A skill on an org A date');

RESET ROLE;

-- 3: org_id was auto-derived from the show_date, not sent by the client.
SELECT is(
  (SELECT org_id FROM public.show_date_skill_drops
   WHERE show_date_id = 'd40b0000-0000-0000-0000-00000000d1a0'),
  'd40b0000-0000-0000-0000-00000000000a'::uuid,
  'org_id is derived from the show_date');

SELECT set_config('request.jwt.claims', '{"sub":"d40b0000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- 4: unique(show_date_id, skill_id) blocks a duplicate drop.
SELECT throws_ok($$
  INSERT INTO public.show_date_skill_drops (show_date_id, skill_id)
  VALUES ('d40b0000-0000-0000-0000-00000000d1a0', 'd40b0000-0000-0000-0000-000000000541')
$$, '23505', NULL, 'one drop per (show_date, skill)');

-- 5: the same-org guard rejects a cross-org skill (org B skill on an org A date).
SELECT throws_ok($$
  INSERT INTO public.show_date_skill_drops (show_date_id, skill_id)
  VALUES ('d40b0000-0000-0000-0000-00000000d1a0', 'd40b0000-0000-0000-0000-000000000542')
$$, NULL, 'dropped skill must belong to the same organization',
   'cross-org skill drop raises the same-org guard');

-- 6: an org A member cannot INSERT a drop for a show_date in org B (org_id derives
--    to org B, so the has_org_role WITH CHECK fails → 42501).
SELECT throws_ok($$
  INSERT INTO public.show_date_skill_drops (show_date_id, skill_id)
  VALUES ('d40b0000-0000-0000-0000-00000000d1b0', 'd40b0000-0000-0000-0000-000000000542')
$$, '42501', NULL, 'org A member cannot drop on an org B date');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
