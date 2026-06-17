-- merge_cities: repoints every city_id FK (with unique-conflict handling) then deletes losers;
-- admin-only; cross-org and survivor-in-losers rejected.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;  -- disable derive/updated_at triggers + FK checks during seed
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('dddddddd-0000-4000-a000-0000000000a1','authenticated','authenticated','admin@m.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-0000-4000-a000-0000000000d1','authenticated','authenticated','prod@m.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('dddddddd-0000-4000-0000-0000000a0000','Org A','org-a-merge'),
  ('dddddddd-0000-4000-0000-0000000b0000','Org B','org-b-merge');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('dddddddd-0000-4000-0000-0000000a0000','dddddddd-0000-4000-a000-0000000000a1','admin'),
  ('dddddddd-0000-4000-0000-0000000a0000','dddddddd-0000-4000-a000-0000000000d1','producer');
INSERT INTO public.shows (id, org_id) VALUES ('dddddddd-0000-4000-0000-00000000a501','dddddddd-0000-4000-0000-0000000a0000');
INSERT INTO public.casts (id, org_id, name) VALUES
  ('dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-0000000a0000','Cast 1'),
  ('dddddddd-0000-4000-0000-00000000ca02','dddddddd-0000-4000-0000-0000000a0000','Cast 2');
-- survivor c001 (linked), loser c002 (org A); c0b1 is an org-B city for the cross-org guard
INSERT INTO public.cities (id, org_id, name, airtable_city_key) VALUES
  ('dddddddd-0000-4000-0000-00000000c001','dddddddd-0000-4000-0000-0000000a0000','Berlin','berlin'),
  ('dddddddd-0000-4000-0000-00000000c002','dddddddd-0000-4000-0000-0000000a0000','berlin',NULL),
  ('dddddddd-0000-4000-0000-00000000c0b1','dddddddd-0000-4000-0000-0000000b0000','Hamburg',NULL);
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id, city_id) VALUES
  ('dddddddd-0000-4000-0000-00000000d001','dddddddd-0000-4000-0000-00000000a501','2026-07-01','19:00','dddddddd-0000-4000-0000-0000000a0000','dddddddd-0000-4000-0000-00000000c002');
INSERT INTO public.show_cast_eligibility (id, show_id, city_id, cast_id, org_id) VALUES
  ('dddddddd-0000-4000-0000-00000000e001','dddddddd-0000-4000-0000-00000000a501','dddddddd-0000-4000-0000-00000000c002','dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-0000000a0000');
-- survivor already has cast1@priority1; loser has cast1@5 (collides on cast_id -> dropped)
-- and cast2@2 (no collision -> repointed)
INSERT INTO public.cast_city_priority (id, cast_id, city_id, priority, org_id) VALUES
  ('dddddddd-0000-4000-0000-000000000051','dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-00000000c001',1,'dddddddd-0000-4000-0000-0000000a0000'),
  ('dddddddd-0000-4000-0000-0000000000f1','dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-00000000c002',5,'dddddddd-0000-4000-0000-0000000a0000'),
  ('dddddddd-0000-4000-0000-0000000000f2','dddddddd-0000-4000-0000-00000000ca02','dddddddd-0000-4000-0000-00000000c002',2,'dddddddd-0000-4000-0000-0000000a0000');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true); END $$;

-- 1. a non-admin (producer) cannot merge
SELECT pg_temp.act_as('dddddddd-0000-4000-a000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c002']::uuid[]) $$,
  '42501', NULL, 'non-admin cannot merge cities');
RESET ROLE;

-- act as the org admin for the remaining cases
SELECT pg_temp.act_as('dddddddd-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;

-- 2. survivor in losers -> rejected (22023)
SELECT throws_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c001']::uuid[]) $$,
  '22023', NULL, 'survivor cannot be a loser');

-- 3. cross-org loser -> rejected (42501)
SELECT throws_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c0b1']::uuid[]) $$,
  '42501', NULL, 'loser from another org rejected');

-- 4. happy-path merge runs
SELECT lives_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c002']::uuid[]) $$,
  'admin merges loser into survivor');

-- 5. show_dates repointed to survivor
SELECT is((SELECT city_id FROM public.show_dates WHERE id='dddddddd-0000-4000-0000-00000000d001'),
  'dddddddd-0000-4000-0000-00000000c001'::uuid, 'show_date repointed to survivor');

-- 6. eligibility repointed (no survivor collision)
SELECT is((SELECT city_id FROM public.show_cast_eligibility WHERE id='dddddddd-0000-4000-0000-00000000e001'),
  'dddddddd-0000-4000-0000-00000000c001'::uuid, 'eligibility repointed to survivor');

-- 7. cast_city_priority: colliding loser (cast1) dropped, non-colliding (cast2) repointed
SELECT is((SELECT count(*)::int FROM public.cast_city_priority WHERE city_id='dddddddd-0000-4000-0000-00000000c001'),
  2, 'survivor has 2 priority rows (its own cast1 + repointed cast2)');
SELECT is((SELECT count(*)::int FROM public.cast_city_priority WHERE cast_id='dddddddd-0000-4000-0000-00000000ca01' AND city_id='dddddddd-0000-4000-0000-00000000c001'),
  1, 'cast1 priority kept exactly once (survivor wins, loser dropped)');

-- 8. loser city deleted
SELECT is((SELECT count(*)::int FROM public.cities WHERE id='dddddddd-0000-4000-0000-00000000c002'),
  0, 'loser city deleted');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
