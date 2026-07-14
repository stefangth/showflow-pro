-- enforce_booking_flow_pairing: a booking_flow value with artist_acceptance=false AND
-- producer_confirmation=false is COERCED so producer_confirmation becomes true (mirrors
-- the TS normalize layer). Non-booking_flow keys and malformed (non-object) values pass
-- through untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000bf01','PairOrg','pair-org'),
  ('00000000-0000-0000-0000-00000000bf02','PairOrgB','pair-org-b');
SET session_replication_role = DEFAULT;

-- 1. INSERT with both flags false → stored producer_confirmation coerced to true
INSERT INTO public.app_settings (org_id, key, value)
VALUES ('00000000-0000-0000-0000-00000000bf01','booking_flow',
        '{"artist_acceptance":false,"producer_confirmation":false}'::jsonb);
SELECT is(
  (SELECT value->>'producer_confirmation' FROM public.app_settings
   WHERE org_id='00000000-0000-0000-0000-00000000bf01' AND key='booking_flow'),
  'true', 'insert with both false → producer_confirmation healed to true');

-- artist_acceptance is left untouched by the guard
SELECT is(
  (SELECT value->>'artist_acceptance' FROM public.app_settings
   WHERE org_id='00000000-0000-0000-0000-00000000bf01' AND key='booking_flow'),
  'false', 'insert leaves artist_acceptance untouched');

-- 2. UPDATE back to both false → coerced again on write
UPDATE public.app_settings
SET value='{"artist_acceptance":false,"producer_confirmation":false}'::jsonb
WHERE org_id='00000000-0000-0000-0000-00000000bf01' AND key='booking_flow';
SELECT is(
  (SELECT value->>'producer_confirmation' FROM public.app_settings
   WHERE org_id='00000000-0000-0000-0000-00000000bf01' AND key='booking_flow'),
  'true', 'update with both false → producer_confirmation healed to true');

-- 3. A non-booking_flow key with both flags false is NOT touched by the guard
INSERT INTO public.app_settings (org_id, key, value)
VALUES ('00000000-0000-0000-0000-00000000bf01','some_other_key',
        '{"artist_acceptance":false,"producer_confirmation":false}'::jsonb);
SELECT is(
  (SELECT value->>'producer_confirmation' FROM public.app_settings
   WHERE org_id='00000000-0000-0000-0000-00000000bf01' AND key='some_other_key'),
  'false', 'non-booking_flow key is untouched');

-- 4. A malformed (non-object) booking_flow value passes through unmodified (no throw).
-- Uses a second org so the (org_id, key) pair stays unique; the guard's
-- jsonb_typeof(...) = 'object' check short-circuits before any ->> deref.
SELECT lives_ok(
  $$INSERT INTO public.app_settings (org_id, key, value)
    VALUES ('00000000-0000-0000-0000-00000000bf02','booking_flow','"not-an-object"'::jsonb)$$,
  'malformed (non-object) booking_flow value passes through without error');

SELECT * FROM finish();
ROLLBACK;
