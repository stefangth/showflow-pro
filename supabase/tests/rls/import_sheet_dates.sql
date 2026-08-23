-- pgTAP: import_sheet_dates RPC (Phase 4, Task A1). Set-based upsert of Google Sheet
-- rows into show_dates keyed on the partial-unique (org_id, show_id, date) WHERE source='sheet'.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(17);

-- Seed with RLS bypassed.
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'v3-import-admin@example.com');
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Org One', 'v3-import-org-one');
INSERT INTO public.org_memberships (user_id, org_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'admin');
INSERT INTO public.shows (id, org_id, program, sub_program, status) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'Cats', 'Evening', 'active');
INSERT INTO public.cities (id, org_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'Berlin');

-- Second org (B), with its own show, used only for the cross-org write assertion below.
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000000f2', 'Org Two', 'v3-import-org-two');
INSERT INTO public.shows (id, org_id, program, sub_program, status) VALUES
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f2', 'Chess', 'Evening', 'active');
SET session_replication_role = DEFAULT;

-- 1. service_role has EXECUTE on the RPC (the runtime caller; see Global Constraints).
SELECT ok(
  has_function_privilege('service_role', 'public.import_sheet_dates(uuid, jsonb)', 'EXECUTE'),
  'service_role can execute import_sheet_dates'
);

-- 2. First import inserts a source=sheet row for the (org, show, date), and returns new_ids.
DO $$
DECLARE
  v_result jsonb;
  v_new_id uuid;
BEGIN
  v_result := public.import_sheet_dates(
    '00000000-0000-0000-0000-0000000000f1',
    '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-01","city_id":"00000000-0000-0000-0000-0000000000d1","session_1":"19:30"}]'::jsonb
  );
  PERFORM set_config('pgtap.import_result', v_result::text, true);

  SELECT id INTO v_new_id FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet';
  PERFORM set_config('pgtap.new_date_id', v_new_id::text, true);
END $$;

SELECT is(
  (current_setting('pgtap.import_result')::jsonb ->> 'new_count')::int,
  1,
  'first import inserts one new date'
);
SELECT is(
  (SELECT count(*)::int FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet'),
  1, 'the inserted row is stamped source=sheet with org_id derived'
);
SELECT is(
  jsonb_array_length(current_setting('pgtap.import_result')::jsonb -> 'new_ids'),
  1,
  'new_ids has length 1 on a fresh import'
);
SELECT is(
  (current_setting('pgtap.import_result')::jsonb -> 'new_ids' ->> 0)::uuid,
  current_setting('pgtap.new_date_id')::uuid,
  'new_ids contains the inserted row id'
);

-- 3. Re-importing the same (org, show, date) UPDATES, does not duplicate (idempotent).
SELECT is(
  (public.import_sheet_dates(
     '00000000-0000-0000-0000-0000000000f1',
     '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-01","city_id":"00000000-0000-0000-0000-0000000000d1","session_1":"20:00"}]'::jsonb
   ) ->> 'updated_count')::int,
  1, 're-import updates the existing sheet row'
);
SELECT is(
  (SELECT session_1 FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet'),
  '20:00', 're-import overwrote session_1'
);
SELECT is(
  (SELECT count(*)::int FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01'),
  1, 'still exactly one row (no duplicate)'
);

-- 3a. A re-import with a blank/unresolved city (city_id null) must NOT wipe a
-- previously resolved city, while a session change on that same re-import DOES apply.
SELECT is(
  (public.import_sheet_dates(
     '00000000-0000-0000-0000-0000000000f1',
     '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-01","session_1":"20:30"}]'::jsonb
   ) ->> 'updated_count')::int,
  1, 're-import with a null city updates the existing sheet row'
);
SELECT is(
  (SELECT city_id FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet'),
  '00000000-0000-0000-0000-0000000000d1'::uuid,
  'the previously resolved city_id survives a re-import with a null city'
);
SELECT is(
  (SELECT session_1 FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet'),
  '20:30', 'a session change on the same re-import still applies'
);

-- 3b. Within-batch duplicate keys: two rows in a single call resolving to the same
-- (show_id, date) must not raise ON CONFLICT DO UPDATE's "command cannot affect row a
-- second time" error, must insert exactly one row, and last-row-wins.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.import_sheet_dates(
    '00000000-0000-0000-0000-0000000000f1',
    '[
       {"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-04","session_1":"18:00"},
       {"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-04","session_1":"21:15"}
     ]'::jsonb
  );
  PERFORM set_config('pgtap.dup_result', v_result::text, true);
END $$;

SELECT is(
  (current_setting('pgtap.dup_result')::jsonb ->> 'new_count')::int,
  1,
  'within-batch duplicate keys collapse to one insert, not a raised error'
);
SELECT is(
  (SELECT count(*)::int FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-04'),
  1, 'only one row exists for the duplicated (show_id, date) key'
);
SELECT is(
  (SELECT session_1 FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-04' AND source = 'sheet'),
  '21:15', 'the surviving row keeps the last duplicate row''s session_1 (last-row-wins)'
);

-- 4. A non-member caller cannot import (org guard). Impersonate a user with no membership.
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a9', 'v3-import-outsider@example.com');
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.import_sheet_dates(
       '00000000-0000-0000-0000-0000000000f1',
       '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-02"}]'::jsonb) $$,
  'P0001', NULL, 'a non-member cannot import sheet dates'
);
RESET ROLE;

-- 5. Cross-org write guard: an admin of org A passes p_org=A with a show_id that belongs
-- to org B. The row must be silently dropped (never inserted anywhere), not just rejected.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.import_sheet_dates(
     '00000000-0000-0000-0000-0000000000f1',
     '[{"show_id":"00000000-0000-0000-0000-0000000000c2","date":"2026-09-03"}]'::jsonb
   ) ->> 'new_count')::int,
  0, 'a row whose show belongs to a different org than p_org is dropped, not inserted'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c2' AND date = '2026-09-03'),
  0, 'no show_dates row exists for the foreign-org show/date after the attempted cross-org import'
);

SELECT * FROM finish();
ROLLBACK;
