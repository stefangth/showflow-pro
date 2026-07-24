-- pgTAP: layered capability resolver (is_capability_enabled / is_capability_locked /
-- capability_default), the org-admin write RLS on org_capabilities (unlocked only),
-- and the org_capability_policies audit trail.
--
-- UUID legend (test-only, rolled back):
--   aaaaaaaa-ca90-0001-…  admin user
--   aaaaaaaa-ca90-0002-…  producer user
--   00000000-…-b007       bootstrap org (shared by the other suites)

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

-- ── Fixtures (as superuser; replica disables FK/auth triggers) ───────────────
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-ca90-0001-0000-000000000000','authenticated','authenticated','cap-admin@test.com',   now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('aaaaaaaa-ca90-0002-0000-000000000000','authenticated','authenticated','cap-producer@test.com',now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now());
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-ca90-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-ca90-0002-0000-000000000000','producer');
SET session_replication_role = DEFAULT;

-- ── Resolver layering (security-definer functions; no role switch needed) ────
-- 1. registry default
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), false, 'rename_org registry default false');
-- 2. org override wins
INSERT INTO public.org_capabilities (org_id, capability, enabled)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_rename_org', true);
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), true, 'org override wins over registry default');
-- 3. lock forces the platform value over the org override
INSERT INTO public.org_capability_policies (org_id, capability, enabled, locked)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_rename_org', false, true);
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), false, 'lock beats org override');
-- 4. is_capability_locked reflects the policy
SELECT is(public.is_capability_locked('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), true, 'is_capability_locked true');
-- 5. platform default applies when unlocked with no org override
INSERT INTO public.org_capability_policies (org_id, capability, enabled, locked)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_edit_scheduling', false, false);
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_edit_scheduling'), false, 'platform default applies when unlocked');

-- Setup for the locked-INSERT-denial test: a locked policy with no org override.
INSERT INTO public.org_capability_policies (org_id, capability, enabled, locked)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_hard_delete_show_dates', false, true);

-- ── Org-admin write RLS ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-ca90-0001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- 6. admin may insert an override for an UNLOCKED capability
SELECT lives_ok(
  $$ insert into public.org_capabilities (org_id, capability, enabled)
     values ('00000000-0000-0000-0000-00000000b007','producer_can_hard_delete_productions', true) $$,
  'admin writes unlocked capability override');
-- 7. admin may NOT insert an override for a LOCKED capability (WITH CHECK fails)
SELECT throws_ok(
  $$ insert into public.org_capabilities (org_id, capability, enabled)
     values ('00000000-0000-0000-0000-00000000b007','producer_can_hard_delete_show_dates', true) $$,
  '42501', NULL, 'admin blocked from writing a locked capability');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-ca90-0002-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- 8. producer may NOT write capability overrides at all
SELECT throws_ok(
  $$ insert into public.org_capabilities (org_id, capability, enabled)
     values ('00000000-0000-0000-0000-00000000b007','producer_can_manage_casts', false) $$,
  '42501', NULL, 'producer cannot write capability overrides');
-- 9. producer (member) CAN read policies
SELECT is(
  (select count(*)::int from public.org_capability_policies
   where org_id = '00000000-0000-0000-0000-00000000b007'
     and capability in ('producer_can_rename_org','producer_can_edit_scheduling','producer_can_hard_delete_show_dates')),
  3, 'producer can read capability policies');
RESET ROLE;

-- ── Audit trail (settings_audit_log key capability_policy:<name>) ─────────────
-- 10. the policy insert from test 3 was audited
SELECT is(
  (select count(*)::int from public.settings_audit_log
   where key = 'capability_policy:producer_can_rename_org'),
  1, 'policy insert audited');
-- 11. a real update is audited
UPDATE public.org_capability_policies SET enabled = true
  WHERE org_id = '00000000-0000-0000-0000-00000000b007' AND capability = 'producer_can_rename_org';
SELECT is(
  (select count(*)::int from public.settings_audit_log
   where key = 'capability_policy:producer_can_rename_org'),
  2, 'policy update audited');
-- 12. a no-op update is not audited
UPDATE public.org_capability_policies SET enabled = true
  WHERE org_id = '00000000-0000-0000-0000-00000000b007' AND capability = 'producer_can_rename_org';
SELECT is(
  (select count(*)::int from public.settings_audit_log
   where key = 'capability_policy:producer_can_rename_org'),
  2, 'no-op update not audited');

SELECT * FROM finish();
ROLLBACK;
