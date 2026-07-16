-- Configurable eligibility (booking flow phase 4): show-scoped cast priorities on
-- show_cast_eligibility, and the uniform required-skills tables per show and per date.
-- See migration 20260715130000_configurable_eligibility.sql.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- Seed: one org, one city, one cast, one show, one date, one skill; a second org + skill.
INSERT INTO public.organizations (id, name, slug) VALUES
  ('e11a0000-0000-0000-0000-00000000000a', 'Elig Org A', 'elig-org-a'),
  ('e11a0000-0000-0000-0000-00000000000b', 'Elig Org B', 'elig-org-b');
INSERT INTO public.cities (id, org_id, name) VALUES
  ('e11a0000-0000-0000-0000-0000000000c1', 'e11a0000-0000-0000-0000-00000000000a', 'Berlin');
INSERT INTO public.casts (id, org_id, name) VALUES
  ('e11a0000-0000-0000-0000-0000000000ca', 'e11a0000-0000-0000-0000-00000000000a', 'Cast A'),
  ('e11a0000-0000-0000-0000-0000000000cb', 'e11a0000-0000-0000-0000-00000000000a', 'Cast B');
INSERT INTO public.shows (id, org_id, program) VALUES
  ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-00000000000a', 'Show A');
INSERT INTO public.show_dates (id, org_id, show_id, city_id, date, session_1) VALUES
  ('e11a0000-0000-0000-0000-0000000000d1', 'e11a0000-0000-0000-0000-00000000000a',
   'e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1', '2027-01-15', '19:00');
INSERT INTO public.skills (id, org_id, name) VALUES
  ('e11a0000-0000-0000-0000-000000000541', 'e11a0000-0000-0000-0000-00000000000a', 'judge'),
  ('e11a0000-0000-0000-0000-000000000542', 'e11a0000-0000-0000-0000-00000000000b', 'foreign');

-- 1: priority accepts NULL (legacy gate rows unchanged)
SELECT lives_ok($$
  INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id, org_id)
  VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1',
          'e11a0000-0000-0000-0000-0000000000ca', 'e11a0000-0000-0000-0000-00000000000a')
$$, 'gate row without priority inserts');

-- 2: priority >= 1 enforced
SELECT throws_ok($$
  UPDATE public.show_cast_eligibility SET priority = 0
  WHERE cast_id = 'e11a0000-0000-0000-0000-0000000000ca'
$$, '23514', NULL, 'priority 0 violates the check');

-- 3: assigning a valid priority works
SELECT lives_ok($$
  UPDATE public.show_cast_eligibility SET priority = 1
  WHERE cast_id = 'e11a0000-0000-0000-0000-0000000000ca'
$$, 'priority 1 assigns');

-- 4: partial unique blocks a second cast at the same (show, city, priority)
SELECT throws_ok($$
  INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id, org_id, priority)
  VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1',
          'e11a0000-0000-0000-0000-0000000000cb', 'e11a0000-0000-0000-0000-00000000000a', 1)
$$, '23505', NULL, 'one cast per tier per show and city');

-- 5: two NULL-priority rows coexist (partial index ignores NULLs)
SELECT lives_ok($$
  INSERT INTO public.show_cast_eligibility (show_id, city_id, cast_id, org_id)
  VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-0000000000c1',
          'e11a0000-0000-0000-0000-0000000000cb', 'e11a0000-0000-0000-0000-00000000000a')
$$, 'untiered rows are not constrained by the priority index');

-- 6: org derivation overwrites a client-sent org_id on show_required_skills
INSERT INTO public.show_required_skills (show_id, skill_id, org_id)
VALUES ('e11a0000-0000-0000-0000-00000000005a', 'e11a0000-0000-0000-0000-000000000541',
        'e11a0000-0000-0000-0000-00000000000b');
SELECT is(
  (SELECT org_id FROM public.show_required_skills
   WHERE show_id = 'e11a0000-0000-0000-0000-00000000005a'),
  'e11a0000-0000-0000-0000-00000000000a'::uuid,
  'org_id is derived from the show, not taken from the client');

-- 7: cross-org skill is rejected by the same-org guard
SELECT throws_ok($$
  INSERT INTO public.show_date_required_skills (show_date_id, skill_id, org_id)
  VALUES ('e11a0000-0000-0000-0000-0000000000d1', 'e11a0000-0000-0000-0000-000000000542',
          'e11a0000-0000-0000-0000-00000000000a')
$$, NULL, 'required skill must belong to the same organization',
   'cross-org skill insert raises');

-- 8: RLS is enabled on both new tables
SELECT is(
  (SELECT count(*) FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN ('show_required_skills', 'show_date_required_skills')
     AND rowsecurity), 2::bigint, 'RLS enabled on both requirement tables');

SELECT * FROM finish();
ROLLBACK;
