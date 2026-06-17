-- Catalog-link keys are unique PER ORG (free across orgs); many rows stay NULL.
-- Keys are grain-agnostic opaque text (the value the admin's field mapping yields).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-airtable-link'),
  ('22222222-2222-2222-2222-222222222222', 'Org B', 'org-b-airtable-link');

-- ── shows.airtable_program_key ───────────────────────────────────────────────
INSERT INTO public.shows (id, org_id, program, sub_program, status, airtable_program_key)
  VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active', 'TJE: Murder');

-- 1) the same key in a DIFFERENT org is allowed (per-org, not global, uniqueness)
SELECT lives_ok(
  $$ INSERT INTO public.shows (org_id, program, sub_program, status, airtable_program_key)
     VALUES ('22222222-2222-2222-2222-222222222222', 'TJE', 'TJE: Murder', 'active', 'TJE: Murder') $$,
  'same airtable_program_key in another org is allowed');

-- 2) a duplicate key WITHIN the same org is rejected
SELECT throws_ok(
  $$ INSERT INTO public.shows (org_id, program, sub_program, status, airtable_program_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Other', 'active', 'TJE: Murder') $$,
  '23505', NULL,
  'duplicate airtable_program_key within an org is rejected');

-- 3) multiple UNLINKED (NULL) shows in one org are allowed (partial index excludes NULL)
SELECT lives_ok(
  $$ INSERT INTO public.shows (org_id, program, sub_program, status, airtable_program_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'X', 'X1', 'active', NULL),
            ('11111111-1111-1111-1111-111111111111', 'Y', 'Y1', 'active', NULL) $$,
  'multiple NULL airtable_program_key rows in one org are allowed');

-- ── cities.airtable_city_key ─────────────────────────────────────────────────
INSERT INTO public.cities (id, org_id, name, airtable_city_key)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Berlin', 'Berlin');

-- 4) the same city key in another org is allowed
SELECT lives_ok(
  $$ INSERT INTO public.cities (org_id, name, airtable_city_key)
     VALUES ('22222222-2222-2222-2222-222222222222', 'Berlin', 'Berlin') $$,
  'same airtable_city_key in another org is allowed');

-- 5) a duplicate city key within an org is rejected
SELECT throws_ok(
  $$ INSERT INTO public.cities (org_id, name, airtable_city_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'Berlin Alt', 'Berlin') $$,
  '23505', NULL,
  'duplicate airtable_city_key within an org is rejected');

-- 6) multiple UNLINKED (NULL) cities in one org are allowed
SELECT lives_ok(
  $$ INSERT INTO public.cities (org_id, name, airtable_city_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'Hamburg', NULL),
            ('11111111-1111-1111-1111-111111111111', 'Munich', NULL) $$,
  'multiple NULL airtable_city_key rows in one org are allowed');

SELECT * FROM finish();
ROLLBACK;
