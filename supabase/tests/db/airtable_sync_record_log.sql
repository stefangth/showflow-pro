-- airtable_sync_record_log: org_id derives from the parent log, the action CHECK is enforced,
-- the FK cascades, and RLS is enabled with the org-isolation + admin-read policies.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-syncrec');

INSERT INTO public.airtable_sync_log (id, org_id, sync_type, status, synced_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111', 'airtable_poll', 'partial', now());

-- 1) RLS is enabled on the table
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.airtable_sync_record_log'::regclass),
  true,
  'RLS is enabled on airtable_sync_record_log');

-- 2) org_id is derived from the parent log by the trigger (insert WITHOUT org_id succeeds + is stamped)
INSERT INTO public.airtable_sync_record_log (sync_log_id, airtable_record_id, action, reason)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'recTEST1', 'held_unresolved', 'program ''X'' not linked');
SELECT is(
  (SELECT org_id FROM public.airtable_sync_record_log WHERE airtable_record_id = 'recTEST1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'org_id is derived from the parent sync_log row');

-- 3) the action CHECK rejects an unknown action
SELECT throws_ok(
  $$ INSERT INTO public.airtable_sync_record_log (sync_log_id, action)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bogus') $$,
  '23514', NULL,
  'action CHECK rejects values outside the allowed set');

-- 4) the org-isolation policy exists
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE tablename = 'airtable_sync_record_log' AND policyname = 'org_isolation'),
  1, 'org_isolation policy exists');

-- 5) deleting the parent log cascades to its record rows
DELETE FROM public.airtable_sync_log WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT is(
  (SELECT count(*)::int FROM public.airtable_sync_record_log WHERE airtable_record_id = 'recTEST1'),
  0, 'deleting the parent sync_log cascades to record logs');

SELECT * FROM finish();
ROLLBACK;
