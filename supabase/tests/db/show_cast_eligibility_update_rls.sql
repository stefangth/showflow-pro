-- show_cast_eligibility had SELECT, INSERT, DELETE permissive policies but no
-- UPDATE policy (see 20260716093000_show_cast_eligibility_update_policy.sql).
-- The configurable eligibility phase's priority editor (setShowCastPriority /
-- clearShowCastPriority in src/data/eligibility.ts) writes via UPDATE, which
-- RLS silently filtered to zero rows for every authenticated caller. These
-- tests run AS an authenticated org member (not privileged), mirroring the
-- act_as/SET LOCAL ROLE pattern in org_member_management.sql, so they catch
-- an RLS gap that a privileged test run would miss.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

-- Seed: two orgs, each with an admin user, a city, a cast, a show, and one
-- eligibility row with priority 1.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('e11c0000-0000-4000-a000-0000000000a1','authenticated','authenticated','e11c-a1@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('e11c0000-0000-4000-a000-0000000000b1','authenticated','authenticated','e11c-b1@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('e11c0000-0000-0000-0000-00000000a000','Elig RLS Org A','elig-rls-org-a'),
  ('e11c0000-0000-0000-0000-00000000b000','Elig RLS Org B','elig-rls-org-b');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('e11c0000-0000-0000-0000-00000000a000','e11c0000-0000-4000-a000-0000000000a1','admin'),
  ('e11c0000-0000-0000-0000-00000000b000','e11c0000-0000-4000-a000-0000000000b1','admin');
INSERT INTO public.cities (id, org_id, name) VALUES
  ('e11c0000-0000-0000-0000-0000000000c1','e11c0000-0000-0000-0000-00000000a000','RLS City A');
INSERT INTO public.casts (id, org_id, name) VALUES
  ('e11c0000-0000-0000-0000-0000000000ca','e11c0000-0000-0000-0000-00000000a000','RLS Cast A');
INSERT INTO public.shows (id, org_id, program) VALUES
  ('e11c0000-0000-0000-0000-00000000005a','e11c0000-0000-0000-0000-00000000a000','RLS Show A');
INSERT INTO public.show_cast_eligibility (id, show_id, city_id, cast_id, org_id, priority) VALUES
  ('e11c0000-0000-0000-0000-0000000000e1','e11c0000-0000-0000-0000-00000000005a','e11c0000-0000-0000-0000-0000000000c1',
   'e11c0000-0000-0000-0000-0000000000ca','e11c0000-0000-0000-0000-00000000a000',1);
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- 1 & 2: an org admin CAN update priority on their own org's row.
SELECT pg_temp.act_as('e11c0000-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
WITH updated AS (
  UPDATE public.show_cast_eligibility SET priority = 2
  WHERE id = 'e11c0000-0000-0000-0000-0000000000e1'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM updated), 1, 'org admin update affects 1 row');
RESET ROLE;
SELECT is(
  (SELECT priority FROM public.show_cast_eligibility WHERE id = 'e11c0000-0000-0000-0000-0000000000e1'),
  2, 'org admin update actually changed the priority');

-- 3 & 4: an admin of a DIFFERENT org cannot update it (RLS filters to 0 rows,
-- no exception, priority stays unchanged).
SELECT pg_temp.act_as('e11c0000-0000-4000-a000-0000000000b1');
SET LOCAL ROLE authenticated;
WITH updated AS (
  UPDATE public.show_cast_eligibility SET priority = 3
  WHERE id = 'e11c0000-0000-0000-0000-0000000000e1'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM updated), 0, 'cross-org admin update affects 0 rows');
RESET ROLE;
SELECT is(
  (SELECT priority FROM public.show_cast_eligibility WHERE id = 'e11c0000-0000-0000-0000-0000000000e1'),
  2, 'cross-org admin update did not change the priority');

SELECT * FROM finish();
ROLLBACK;
