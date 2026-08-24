-- backfill_getrunning_dates_source(): stamp the Wireflow v3 `getrunning_dates_source`
-- app_settings override for orgs that set up their dates source under the v1 board (which
-- never wrote that key). The v3 get-running board reads this key to decide the source/
-- connect/map steps; an org that already configured Airtable/Sheet sync, or entered dates
-- by hand, must read back its true source instead of an unset "pick a source" to-do.
--
-- Inference precedence, per org lacking a getrunning_dates_source override:
--   airtable  -- airtable_sync_enabled=true OR a non-empty airtable_base_id
--   sheet     -- a non-empty sheet_import_settings.url
--   manual    -- otherwise, if the org has any show_dates row
--   (skip)    -- a brand-new org with none of the above keeps no override (wizard decides)
--
--   a1a1...0001 airtable via base_id
--   a1a1...0002 airtable via sync_enabled flag (no base_id)
--   a1a1...0003 sheet via saved url
--   a1a1...0004 manual (has a show_date, no sync config)
--   a1a1...0005 brand-new (nothing) -> no row
--   a1a1...0006 already chose 'manual' AND has airtable config -> must NOT be clobbered
--   a1a1...0007 airtable config AND has dates -> airtable wins (precedence)
--   a1a1...0008 empty airtable_base_id + sync off, no dates -> no row
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000001','AT base','gr-ds-at-base'),
  ('a1a1a1a1-0000-4000-8000-000000000002','AT syncflag','gr-ds-at-flag'),
  ('a1a1a1a1-0000-4000-8000-000000000003','Sheet','gr-ds-sheet'),
  ('a1a1a1a1-0000-4000-8000-000000000004','Manual','gr-ds-manual'),
  ('a1a1a1a1-0000-4000-8000-000000000005','New','gr-ds-new'),
  ('a1a1a1a1-0000-4000-8000-000000000006','Already','gr-ds-already'),
  ('a1a1a1a1-0000-4000-8000-000000000007','Both','gr-ds-both'),
  ('a1a1a1a1-0000-4000-8000-000000000008','AT empty','gr-ds-at-empty');

-- 0001: airtable via a non-empty base id
INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000001','airtable_base_id', to_jsonb('appLegacy001'::text)),
  ('a1a1a1a1-0000-4000-8000-000000000001','airtable_table_name', to_jsonb('Dates'::text));

-- 0002: airtable via the sync-enabled flag, base id absent
INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000002','airtable_sync_enabled', to_jsonb(true));

-- 0003: sheet via a saved published-CSV url
INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000003','sheet_import_settings',
   '{"url":"https://docs.google.com/spreadsheets/d/e/x/pub?output=csv","map":{}}'::jsonb);

-- 0004: manual -- a show with one date, no sync config
INSERT INTO public.shows (id, org_id, program) VALUES
  ('a2a2a2a2-0000-4000-8000-000000000004','a1a1a1a1-0000-4000-8000-000000000004','Show M');
INSERT INTO public.show_dates (org_id, show_id, date) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000004','a2a2a2a2-0000-4000-8000-000000000004','2026-06-01');

-- 0006: already has an override AND airtable config -> no-clobber
INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000006','getrunning_dates_source', to_jsonb('manual'::text)),
  ('a1a1a1a1-0000-4000-8000-000000000006','airtable_base_id', to_jsonb('appLegacy006'::text));

-- 0007: airtable config AND dates -> airtable wins
INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000007','airtable_base_id', to_jsonb('appLegacy007'::text));
INSERT INTO public.shows (id, org_id, program) VALUES
  ('a2a2a2a2-0000-4000-8000-000000000007','a1a1a1a1-0000-4000-8000-000000000007','Show B');
INSERT INTO public.show_dates (org_id, show_id, date) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000007','a2a2a2a2-0000-4000-8000-000000000007','2026-06-02');

-- 0008: empty base id + sync off, nothing else -> treated as unset
INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000008','airtable_base_id', to_jsonb(''::text)),
  ('a1a1a1a1-0000-4000-8000-000000000008','airtable_sync_enabled', to_jsonb(false));

-- Run the backfill. Its return counts EVERY inferable org in the database (CI applies
-- seed.sql after migrations, so seeded orgs are unstamped and counted here too) -- assert
-- the fixture-scoped effect, not the global count. Five fixtures get a fresh row
-- (0001,0002,0003,0004,0007); 0006 already has one (skipped), 0005/0008 have nothing to infer.
SELECT public.backfill_getrunning_dates_source();
SELECT is(
  (SELECT count(*)::int FROM public.app_settings
   WHERE key = 'getrunning_dates_source'
     AND org_id IN (
       'a1a1a1a1-0000-4000-8000-000000000001',
       'a1a1a1a1-0000-4000-8000-000000000002',
       'a1a1a1a1-0000-4000-8000-000000000003',
       'a1a1a1a1-0000-4000-8000-000000000004',
       'a1a1a1a1-0000-4000-8000-000000000007')),
  5, 'first run stamps exactly the five inferable fixture orgs');

SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000001' AND key = 'getrunning_dates_source'),
  'airtable', '0001: base id -> airtable');
SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000002' AND key = 'getrunning_dates_source'),
  'airtable', '0002: sync-enabled flag -> airtable');
SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000003' AND key = 'getrunning_dates_source'),
  'sheet', '0003: saved sheet url -> sheet');
SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000004' AND key = 'getrunning_dates_source'),
  'manual', '0004: has dates, no sync -> manual');
SELECT is(
  (SELECT count(*)::int FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000005' AND key = 'getrunning_dates_source'),
  0, '0005: brand-new org gets no override');
SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000006' AND key = 'getrunning_dates_source'),
  'manual', '0006: existing override is never clobbered');
SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000007' AND key = 'getrunning_dates_source'),
  'airtable', '0007: airtable wins over manual dates');
SELECT is(
  (SELECT count(*)::int FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000008' AND key = 'getrunning_dates_source'),
  0, '0008: empty base id + sync off gets no override');

-- Idempotency: a second run inserts nothing and disturbs nothing.
SELECT is(public.backfill_getrunning_dates_source(), 0,
  'second run is a no-op (zero rows inserted)');
SELECT is(
  (SELECT value #>> '{}' FROM public.app_settings
   WHERE org_id = 'a1a1a1a1-0000-4000-8000-000000000001' AND key = 'getrunning_dates_source'),
  'airtable', 'idempotent: 0001 still airtable after a second run');

SELECT * FROM finish();
ROLLBACK;
