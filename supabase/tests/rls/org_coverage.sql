-- Phase 0 COVERAGE GUARD: every tenant table must carry org_id and have RLS
-- enabled. (Policy-presence assertions are added in iteration 2 alongside the
-- policy rewrite.) profiles is GLOBAL and intentionally excluded; user_roles /
-- user_approvals are not org-scoped.
--
-- pgTAP note: assertions must be emitted as top-level SELECT rows (one row per
-- table via a set-returning SELECT), NOT inside a PL/pgSQL loop — PERFORM'd
-- assertions are discarded and never reach the TAP stream.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

CREATE TEMP TABLE _tenant_tables(name text) ON COMMIT DROP;
INSERT INTO _tenant_tables(name) VALUES
  ('shows'),('show_dates'),('show_date_offer_tiers'),('show_cast_eligibility'),
  ('show_date_cast_eligibility'),('bookings'),('booking_audit_log'),('casts'),
  ('cast_members'),('cast_city_priority'),('cities'),('skills'),('artist_skills'),
  ('blocked_dates'),('show_assignments'),('chats'),('chat_messages'),
  ('notifications'),('airtable_sync_log'),('artists'),('app_settings');

-- 21 tables × 3 assertions
SELECT plan(63);

-- 1) org_id column present on every tenant table
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
    WHERE table_schema='public' AND table_name = tt.name AND column_name='org_id'),
  1,
  tt.name || ' has org_id column')
FROM _tenant_tables tt
ORDER BY tt.name;

-- 2) RLS enabled on every tenant table
SELECT is(
  (SELECT c.relrowsecurity::int FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname = tt.name),
  1,
  tt.name || ' has RLS enabled')
FROM _tenant_tables tt
ORDER BY tt.name;

-- 3) the RESTRICTIVE org_isolation policy is present on every tenant table
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname='public' AND tablename = tt.name AND policyname='org_isolation'),
  tt.name || ' has org_isolation policy')
FROM _tenant_tables tt
ORDER BY tt.name;

SELECT * FROM finish();
ROLLBACK;
