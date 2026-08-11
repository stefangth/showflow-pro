-- Phase 0 COVERAGE GUARD: every tenant table must carry org_id and have RLS
-- enabled. (Policy-presence assertions are added in iteration 2 alongside the
-- policy rewrite.) profiles is GLOBAL and intentionally excluded; user_roles /
-- user_approvals are not org-scoped.
--
-- The list below was frozen at the Phase 0 set (the first 21) and never grew
-- as later features added their own org_id-carrying tables — confirmed by
-- diffing this list against every public table with an org_id column, which
-- turned up 17 more. 13 of those follow the exact same pattern (org_id + RLS
-- + a policy literally named 'org_isolation') and are added below.
-- Deliberately NOT added, because each uses a different isolation mechanism
-- and asserting 'org_isolation' by name on them would be testing the wrong
-- thing (verified individually, not assumed):
--   org_memberships, org_invitations — these tables are what DEFINE org
--     membership; gating a membership row's own visibility on membership
--     would be circular. They carry their own bespoke policies instead.
--   platform_audit_log — platform-scoped by design, not tenant-isolated;
--     read by super-admins across every org.
--   email_send_log — written by edge functions under the service role, not
--     read through a user session subject to org_isolation.
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
  ('notifications'),('airtable_sync_log'),('artists'),('app_settings'),
  ('hire_orders'),('hire_order_dates'),('hire_order_signatures'),('hire_order_imports'),
  ('settings_audit_log'),('show_date_change_log'),('custom_field_definitions'),
  ('airtable_sync_record_log'),('org_entitlements'),('org_capabilities'),
  ('org_capability_policies'),('show_date_required_skills'),('show_required_skills');

-- 34 tables × 3 assertions
SELECT plan(102);

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
