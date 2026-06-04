-- Tests for public.resolve_show_assignments(p_program, p_sub_program, p_city_id, p_org)
-- (4-arg, org-scoped version defined in
--  20260604133000_org_scope_assignments_and_autocancel.sql; the 3-arg version was dropped)
--
-- Signature: resolve_show_assignments(TEXT p_program, TEXT p_sub_program, UUID p_city_id, UUID p_org)
--   RETURNS TABLE(producer_user_id UUID, specificity INT)
--   Candidate rows are additionally restricted to org_id = p_org, so an assignment in
--   another org can never be returned (cross-org isolation, asserted in Test 6).
--
-- Specificity is a top-down CASE over each candidate show_assignments row, evaluated
-- only for rows whose program = p_program AND (sub_program = p_sub_program OR sub_program
-- IS NULL) AND (city_id = p_city_id OR city_id IS NULL):
--   4  sub_program = p_sub_program AND city_id = p_city_id   (program + sub_program + city)
--   3  city_id = p_city_id AND sub_program IS NULL           (program + city)
--   2  sub_program = p_sub_program AND city_id IS NULL       (program + sub_program)
--   1  city_id IS NULL AND sub_program IS NULL               (program only)
--   0  otherwise → excluded (WHERE specificity > 0)
-- Results are ORDER BY specificity DESC. No match → empty set.
--
-- NULL semantics being asserted (exactly as the SQL encodes them):
--   * A row with both sub_program and city_id NULL ALWAYS matches any (program) call
--     at specificity 1 (the "program only" fallback).
--   * SQL equality (sub_program = p_sub_program) is never true when the column is NULL,
--     so a NULL column only contributes via the explicit "IS NULL" arms.
--
-- UUID legend (all test-only, rolled back at end):
--   aaaaaaaa-5a00-000N-…  producer auth.users (one per specificity tier)
--   aaaaaaaa-5a00-0009-…  producer auth.user in the OTHER org (cross-org isolation test)
--   11111111-5a00-000N-…  cities
--   00000000-…-b007       bootstrap org (seeds for tiers 1-4)
--   00000000-…-c0de       a SECOND org (holds a would-match assignment that must be excluded)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures. replica mode disables the auth.users FK trigger on show_assignments
-- and the cities FK so we can seed minimal rows.
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-5a00-0001-0000-000000000000', 'authenticated', 'authenticated', 'sa-prod-full@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-5a00-0002-0000-000000000000', 'authenticated', 'authenticated', 'sa-prod-city@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-5a00-0003-0000-000000000000', 'authenticated', 'authenticated', 'sa-prod-sub@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-5a00-0004-0000-000000000000', 'authenticated', 'authenticated', 'sa-prod-prog@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  -- producer that belongs to a DIFFERENT org (used only by the cross-org isolation test)
  ('aaaaaaaa-5a00-0009-0000-000000000000', 'authenticated', 'authenticated', 'sa-prod-otherorg@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

-- A second org. The bootstrap org (…b007) holds the tier-1..4 seeds; this org holds a
-- would-match (program-only, NULL sub_program, NULL city) assignment that MUST be excluded
-- when resolving for the bootstrap org.
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000c0de', 'SA Other Org', 'sa-other-org');

INSERT INTO public.cities (id, name, org_id) VALUES
  ('11111111-5a00-0001-0000-000000000000', 'SA City One', '00000000-0000-0000-0000-00000000b007'),
  ('11111111-5a00-0002-0000-000000000000', 'SA City Two', '00000000-0000-0000-0000-00000000b007');

-- One assignment per specificity tier, all for program = 'theatre' in the bootstrap org:
--   producer 1: sub_program='musical', city=One   → tier 4 for (theatre, musical, One)
--   producer 2: sub_program=NULL,      city=One   → tier 3 for (theatre, *, One)
--   producer 3: sub_program='musical', city=NULL  → tier 2 for (theatre, musical, *)
--   producer 4: sub_program=NULL,      city=NULL  → tier 1 for (theatre, *, *)
INSERT INTO public.show_assignments (producer_user_id, program, sub_program, city_id, org_id) VALUES
  ('aaaaaaaa-5a00-0001-0000-000000000000', 'theatre', 'musical', '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007'),
  ('aaaaaaaa-5a00-0002-0000-000000000000', 'theatre', NULL,      '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007'),
  ('aaaaaaaa-5a00-0003-0000-000000000000', 'theatre', 'musical', NULL, '00000000-0000-0000-0000-00000000b007'),
  ('aaaaaaaa-5a00-0004-0000-000000000000', 'theatre', NULL,      NULL, '00000000-0000-0000-0000-00000000b007');

-- Cross-org noise: a program-only/NULL-city 'theatre' assignment in the OTHER org. Under the
-- 3-arg (org-blind) function this WOULD surface for any 'theatre' call; the 4-arg function
-- filtered by org_id must never return it for the bootstrap org.
INSERT INTO public.show_assignments (producer_user_id, program, sub_program, city_id, org_id) VALUES
  ('aaaaaaaa-5a00-0009-0000-000000000000', 'theatre', NULL, NULL, '00000000-0000-0000-0000-00000000c0de');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: full-specificity call returns all 4 matches ordered by specificity DESC.
-- (theatre, musical, City One) matches every seeded row at its respective tier.
-- ────────────────────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT producer_user_id, specificity
     FROM public.resolve_show_assignments('theatre', 'musical', '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007') $$,
  $$ VALUES
       ('aaaaaaaa-5a00-0001-0000-000000000000'::uuid, 4),
       ('aaaaaaaa-5a00-0002-0000-000000000000'::uuid, 3),
       ('aaaaaaaa-5a00-0003-0000-000000000000'::uuid, 2),
       ('aaaaaaaa-5a00-0004-0000-000000000000'::uuid, 1) $$,
  'full (program+sub_program+city) call returns all tiers, most-specific first'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: the most-specific row is the top result (specificity 4).
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT producer_user_id FROM public.resolve_show_assignments('theatre', 'musical', '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007') ORDER BY specificity DESC LIMIT 1),
  'aaaaaaaa-5a00-0001-0000-000000000000'::uuid,
  'most-specific (program+sub_program+city) match wins'
);

SELECT is(
  (SELECT max(specificity) FROM public.resolve_show_assignments('theatre', 'musical', '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007')),
  4,
  'top match has the highest possible specificity (4)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: with the tier-4 row removed, the call falls back to tier 3 as the top.
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM public.show_assignments WHERE producer_user_id = 'aaaaaaaa-5a00-0001-0000-000000000000';

SELECT is(
  (SELECT producer_user_id FROM public.resolve_show_assignments('theatre', 'musical', '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007') ORDER BY specificity DESC LIMIT 1),
  'aaaaaaaa-5a00-0002-0000-000000000000'::uuid,
  'removing the tier-4 row falls back to the next specificity (tier 3, program+city)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: querying a different city still matches the tier-2 (sub_program, NULL city)
-- and tier-1 (NULL, NULL) rows; the tier-3 row (bound to City One) is excluded.
-- City Two has no city-specific row, so the program-only fallback (tier 1) is the
-- lowest match and the sub_program-only row (tier 2) is the top.
-- ────────────────────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT producer_user_id, specificity
     FROM public.resolve_show_assignments('theatre', 'musical', '11111111-5a00-0002-0000-000000000000', '00000000-0000-0000-0000-00000000b007') $$,
  $$ VALUES
       ('aaaaaaaa-5a00-0003-0000-000000000000'::uuid, 2),
       ('aaaaaaaa-5a00-0004-0000-000000000000'::uuid, 1) $$,
  'a city with no city-specific row matches only the NULL-city rows (tiers 2 and 1)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5: no match for an unknown program → empty set.
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.resolve_show_assignments('opera', 'classical', '11111111-5a00-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007')),
  0,
  'unknown program → empty result set'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6 (org isolation): a program-only / NULL-city 'theatre' assignment seeded in a
-- DIFFERENT org (producer …0009, org …c0de) would match any 'theatre' call under the old
-- org-blind function. Resolving for the BOOTSTRAP org must NOT return that other-org
-- producer — it returns only the bootstrap org's program-only fallback (tier-1, …0004).
-- ────────────────────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT producer_user_id, specificity
     FROM public.resolve_show_assignments('theatre', NULL, NULL, '00000000-0000-0000-0000-00000000b007') $$,
  $$ VALUES
       ('aaaaaaaa-5a00-0004-0000-000000000000'::uuid, 1) $$,
  'org filter excludes another org''s matching (program-only) assignment'
);

SELECT * FROM finish();
ROLLBACK;
