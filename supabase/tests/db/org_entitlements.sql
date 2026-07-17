-- org_entitlements: per-org feature flags. is_feature_enabled() falls back to the
-- FEATURE_REGISTRY defaults (booking_flow=true, hire_orders=false; mirrors
-- src/lib/entitlements.ts + supabase/functions/_shared/entitlements.ts) when no
-- row exists; an explicit row always wins. Writes are super-admin-only and are
-- audited into settings_audit_log with key = 'entitlement:<feature>'.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

-- ── Seed two orgs + a member of each + a platform super-admin.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000ee11','authenticated','authenticated','ent-member-a@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-00000000ee12','authenticated','authenticated','ent-member-b@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-00000000ee13','authenticated','authenticated','ent-super@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000ee01','EntOrgA','ent-org-a'),
  ('00000000-0000-0000-0000-00000000ee02','EntOrgB','ent-org-b');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000ee01','00000000-0000-0000-0000-00000000ee11','artist'),
  ('00000000-0000-0000-0000-00000000ee02','00000000-0000-0000-0000-00000000ee12','artist');
INSERT INTO public.platform_admins (user_id) VALUES ('00000000-0000-0000-0000-00000000ee13');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- 1 & 2. table shape.
SELECT has_table('public', 'org_entitlements', 'org_entitlements exists');
SELECT col_is_pk('public', 'org_entitlements', ARRAY['org_id','feature'], 'composite pk');

-- 3 & 4. no row => registry defaults (booking_flow on, hire_orders off).
SELECT is(public.is_feature_enabled('00000000-0000-0000-0000-00000000ee01','booking_flow'), true,  'booking_flow default on');
SELECT is(public.is_feature_enabled('00000000-0000-0000-0000-00000000ee01','hire_orders'),  false, 'hire_orders default off');

-- 5. explicit row wins over the default (seeded as the migration owner, bypassing RLS,
--    same as inserting the first row of any freshly-provisioned org).
INSERT INTO public.org_entitlements (org_id, feature, enabled)
VALUES ('00000000-0000-0000-0000-00000000ee01','hire_orders', true);
SELECT is(public.is_feature_enabled('00000000-0000-0000-0000-00000000ee01','hire_orders'), true, 'explicit row wins over default');

-- 6. org member can SELECT their own org's entitlement rows.
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000ee11');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.org_entitlements WHERE org_id='00000000-0000-0000-0000-00000000ee01'),
  1, 'org member reads own org entitlement rows');
RESET ROLE;

-- 7. a member of a different org sees nothing for org A (org_isolation).
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000ee12');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.org_entitlements WHERE org_id='00000000-0000-0000-0000-00000000ee01'),
  0, 'foreign org member sees no rows for org A');
RESET ROLE;

-- 8-10. a plain org member cannot write entitlements (super-admin-only policy).
-- INSERT fails the WITH CHECK clause, which throws; UPDATE does not throw —
-- RLS silently filters the target rows to zero, so assert 0 rows + unchanged value.
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000ee11');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.org_entitlements (org_id, feature, enabled)
    VALUES ('00000000-0000-0000-0000-00000000ee01','some_other_feature', true)$$,
  '42501', NULL, 'org member cannot insert an entitlement row');
WITH updated AS (
  UPDATE public.org_entitlements SET enabled = false
  WHERE org_id = '00000000-0000-0000-0000-00000000ee01' AND feature = 'hire_orders'
  RETURNING 1
)
SELECT is((SELECT count(*)::int FROM updated), 0, 'org member update affects 0 rows');
RESET ROLE;
SELECT is(
  (SELECT enabled FROM public.org_entitlements
   WHERE org_id = '00000000-0000-0000-0000-00000000ee01' AND feature = 'hire_orders'),
  true, 'org member update did not change the value');

-- 11. a super-admin (platform_admins row) can insert.
SELECT pg_temp.act_as('00000000-0000-0000-0000-00000000ee13');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.org_entitlements (org_id, feature, enabled)
    VALUES ('00000000-0000-0000-0000-00000000ee02','hire_orders', true)$$,
  'super-admin can insert an entitlement row');

-- 12. a super-admin can update.
SELECT lives_ok(
  $$UPDATE public.org_entitlements SET enabled = false
    WHERE org_id = '00000000-0000-0000-0000-00000000ee01' AND feature = 'hire_orders'$$,
  'super-admin can update an entitlement row');

-- A no-op update (same value) must not add a third audit row.
UPDATE public.org_entitlements SET enabled = false
  WHERE org_id = '00000000-0000-0000-0000-00000000ee01' AND feature = 'hire_orders';
RESET ROLE;

-- 13. insert + the one changed update above are both audited; the no-op
--     re-update just above added nothing.
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id = '00000000-0000-0000-0000-00000000ee01' AND key = 'entitlement:hire_orders'),
  2, 'insert + update both audited, no-op update not audited');

-- 14. the stamp trigger records who made the last write.
SELECT is(
  (SELECT updated_by FROM public.org_entitlements
   WHERE org_id = '00000000-0000-0000-0000-00000000ee01' AND feature = 'hire_orders'),
  '00000000-0000-0000-0000-00000000ee13'::uuid,
  'stamp trigger records the acting super-admin as updated_by');

SELECT * FROM finish();
ROLLBACK;
