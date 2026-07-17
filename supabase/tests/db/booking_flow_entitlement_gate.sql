-- get_effective_booking_flow(_org): entitlement-aware wrapper over
-- get_org_setting(_org,'booking_flow'). Returns the org's stored booking_flow config
-- when the org is entitled to the booking_flow feature (is_feature_enabled, default-on),
-- and NULL when an org_entitlements row disables it. A NULL is what makes every
-- trigger/policy caller COALESCE back to its classic hard-coded default, so an
-- unentitled org behaves like the pre-booking-flow product.
--
-- Sibling idioms: booking_flow_pairing.sql (app_settings booking_flow rows) +
-- org_entitlements.sql (seeding org_entitlements rows as the migration owner,
-- bypassing the super-admin-only RLS — the same as the first row of any newly
-- provisioned org). No SET ROLE is needed here: the resolver functions are
-- SECURITY DEFINER and are exercised as the (owner) test role.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000ef01','EffOrgA','eff-org-a'),
  ('00000000-0000-0000-0000-00000000ef02','EffOrgB','eff-org-b');
SET session_replication_role = DEFAULT;

-- Org A stores an explicit booking_flow config. artist_acceptance=true keeps the
-- enforce_booking_flow_pairing coercion trigger from rewriting producer_confirmation.
INSERT INTO public.app_settings (org_id, key, value)
VALUES ('00000000-0000-0000-0000-00000000ef01','booking_flow',
        '{"artist_acceptance":true,"producer_confirmation":true,"understudy_promotion":false}'::jsonb);

-- 1. No entitlement row => booking_flow defaults ON => the wrapper passes the stored
--    config straight through.
SELECT is(
  public.get_effective_booking_flow('00000000-0000-0000-0000-00000000ef01'),
  (SELECT value FROM public.app_settings
   WHERE org_id = '00000000-0000-0000-0000-00000000ef01' AND key = 'booking_flow'),
  'default-on org passes its stored booking_flow config through');

-- 2. The wrapper delegates to get_org_setting exactly when entitled (robust against
--    however platform defaults resolve).
SELECT is(
  public.get_effective_booking_flow('00000000-0000-0000-0000-00000000ef01'),
  public.get_org_setting('00000000-0000-0000-0000-00000000ef01','booking_flow'),
  'entitled wrapper == get_org_setting(org,booking_flow)');

-- 3. An explicit enabled=true entitlement row still passes through.
INSERT INTO public.org_entitlements (org_id, feature, enabled)
VALUES ('00000000-0000-0000-0000-00000000ef01','booking_flow', true);
SELECT is(
  public.get_effective_booking_flow('00000000-0000-0000-0000-00000000ef01'),
  (SELECT value FROM public.app_settings
   WHERE org_id = '00000000-0000-0000-0000-00000000ef01' AND key = 'booking_flow'),
  'explicit enabled=true still passes the config through');

-- 4. Flip the entitlement off => the wrapper returns NULL (callers fall back to
--    classic defaults).
UPDATE public.org_entitlements SET enabled = false
  WHERE org_id = '00000000-0000-0000-0000-00000000ef01' AND feature = 'booking_flow';
SELECT is(
  public.get_effective_booking_flow('00000000-0000-0000-0000-00000000ef01'),
  NULL,
  'disabled org falls back to NULL (=> classic defaults)');

-- 5. Sanity: the disabling row really turns the feature off.
SELECT is(
  public.is_feature_enabled('00000000-0000-0000-0000-00000000ef01','booking_flow'),
  false,
  'enabled=false row disables the booking_flow feature');

-- 6. Re-enabling restores pass-through (the config was never deleted, only gated).
UPDATE public.org_entitlements SET enabled = true
  WHERE org_id = '00000000-0000-0000-0000-00000000ef01' AND feature = 'booking_flow';
SELECT is(
  public.get_effective_booking_flow('00000000-0000-0000-0000-00000000ef01'),
  (SELECT value FROM public.app_settings
   WHERE org_id = '00000000-0000-0000-0000-00000000ef01' AND key = 'booking_flow'),
  're-enabling the entitlement restores pass-through');

-- 7. Org B has no booking_flow row of its own: default-on, so the wrapper mirrors
--    get_org_setting (which resolves the platform default, or NULL if none) — proving
--    "unentitled" (NULL) is distinct from "no org-level config".
SELECT is(
  public.get_effective_booking_flow('00000000-0000-0000-0000-00000000ef02'),
  public.get_org_setting('00000000-0000-0000-0000-00000000ef02','booking_flow'),
  'org with no own booking_flow row still delegates to get_org_setting when entitled');

SELECT * FROM finish();
ROLLBACK;
