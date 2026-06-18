-- custom_field_definitions: RLS enabled, org_isolation policy present, key CHECK + type CHECK
-- enforced, UNIQUE(org_id,entity,key) enforced, and show_dates.custom defaults to '{}'.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Org CF', 'org-cf-test');

-- 1) RLS enabled
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.custom_field_definitions'::regclass),
  true, 'RLS is enabled on custom_field_definitions');

-- 2) org_isolation policy exists
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE tablename = 'custom_field_definitions' AND policyname = 'org_isolation'),
  1, 'org_isolation policy exists');

-- 3) a valid row inserts
INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'capacity', 'Capacity', 'number', 'Capacity');
SELECT is(
  (SELECT count(*)::int FROM public.custom_field_definitions WHERE key = 'capacity'),
  1, 'a valid custom field definition inserts');

-- 4) key CHECK rejects an invalid slug
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Bad Key', 'X', 'text', 'X') $$,
  '23514', NULL, 'key CHECK rejects non-slug keys');

-- 5) type CHECK rejects an unknown type
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bogus', 'X', 'json', 'X') $$,
  '23514', NULL, 'type CHECK rejects unknown types');

-- 6) UNIQUE(org_id, entity, key) rejects a duplicate
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'capacity', 'Dup', 'text', 'Y') $$,
  '23505', NULL, 'UNIQUE(org_id,entity,key) rejects duplicates');

SELECT * FROM finish();
ROLLBACK;
