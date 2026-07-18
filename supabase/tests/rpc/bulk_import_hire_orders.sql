-- bulk_import_hire_orders(p_org, p_import, p_rows): producer/admin-guarded,
-- hire_orders-entitlement-gated SECURITY DEFINER bulk insert of DRAFT hire
-- orders from an already-resolved import sheet. Inserts one hire_order_imports
-- row, then loops p_rows creating one hire_orders draft per row -- each row
-- wrapped in its OWN begin/exception block (unlike bulk_import_artists' loop,
-- which has no per-row exception capture) so a malformed row records a
-- per-row 'error' without aborting the batch. Dedup: a row whose
-- (artist_id, show_date_id) already carries an active (non-void) hire order
-- is 'skipped_existing' -- but ONLY when both links are present; unlinked
-- rows are never deduped. Order numbers are generated in-function from the
-- org's hire_order_numbering setting (default HO-{yyyy}-{mmdd}-{seq}), with a
-- unique_violation collision-suffix retry loop.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('aaaaaaaa-b100-0001-0000-000000000000','authenticated','authenticated','b1-producer-a@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-b100-0002-0000-000000000000','authenticated','authenticated','b1-artist-role@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-b200-0001-0000-000000000000','authenticated','authenticated','b1-producer-b@x.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000b10a1','Bulk Hire Org A','bulk-hire-org-a'),
  ('00000000-0000-0000-0000-0000000b20a1','Bulk Hire Org B','bulk-hire-org-b');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000b10a1','aaaaaaaa-b100-0001-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-0000000b10a1','aaaaaaaa-b100-0002-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-0000000b20a1','aaaaaaaa-b200-0001-0000-000000000000','producer');

INSERT INTO public.artists (id, org_id, name, email) VALUES
  ('bbbbbbbb-b100-0001-0000-000000000000','00000000-0000-0000-0000-0000000b10a1','Bulk Artist One','one@x.com'),
  ('bbbbbbbb-b100-0002-0000-000000000000','00000000-0000-0000-0000-0000000b10a1','Bulk Artist Two','two@x.com');

INSERT INTO public.shows (id, org_id, program, sub_program) VALUES
  ('cccccccc-b100-0001-0000-000000000000','00000000-0000-0000-0000-0000000b10a1','theatre','b1-show-a');

INSERT INTO public.show_dates (id, org_id, show_id, date, session_1) VALUES
  ('dddddddd-b100-0001-0000-000000000000','00000000-0000-0000-0000-0000000b10a1','cccccccc-b100-0001-0000-000000000000','2099-10-01','19:00'),
  ('dddddddd-b100-0002-0000-000000000000','00000000-0000-0000-0000-0000000b10a1','cccccccc-b100-0001-0000-000000000000','2099-10-02','19:00');

-- Pre-existing ACTIVE (non-void) hire order for (artist1, sd1) -- the dedup target.
INSERT INTO public.hire_orders (id, org_id, order_no, status, artist_id, show_date_id, data) VALUES
  ('ffffffff-b100-0001-0000-000000000000','00000000-0000-0000-0000-0000000b10a1','HO-EXISTING-1','draft','bbbbbbbb-b100-0001-0000-000000000000','dddddddd-b100-0001-0000-000000000000','{}');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Role gate: an artist-role org member is rejected (regardless of entitlement).
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-b100-0002-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.bulk_import_hire_orders('00000000-0000-0000-0000-0000000b10a1', '{"source":"xlsx","file_name":"x.xlsx","mapping":{},"row_count":0}'::jsonb, '[]'::jsonb) $$,
  '42501', NULL, 'artist-role caller is rejected');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- Cross-org: producer of org B calling with org A's id is rejected.
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-b200-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.bulk_import_hire_orders('00000000-0000-0000-0000-0000000b10a1', '{"source":"xlsx","file_name":"x.xlsx","mapping":{},"row_count":0}'::jsonb, '[]'::jsonb) $$,
  '42501', NULL, 'producer of a different org is rejected (cross-org)');
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- Entitlement gate: hire_orders disabled for org A (no org_entitlements row yet
-- -> registry default false) rejects even a legit producer.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.org_entitlements (org_id, feature, enabled)
VALUES ('00000000-0000-0000-0000-0000000b10a1', 'hire_orders', false);

SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.bulk_import_hire_orders('00000000-0000-0000-0000-0000000b10a1', '{"source":"xlsx","file_name":"x.xlsx","mapping":{},"row_count":0}'::jsonb, '[]'::jsonb) $$,
  '42501', NULL, 'producer caller is rejected while the hire_orders entitlement is disabled');
RESET ROLE;

UPDATE public.org_entitlements SET enabled = true
  WHERE org_id = '00000000-0000-0000-0000-0000000b10a1' AND feature = 'hire_orders';

-- ────────────────────────────────────────────────────────────────────────────
-- Main batch: 5 rows exercising created / skipped_existing / error(malformed) /
-- unlinked-created / explicit-fee-wins-over-sheet-fee, all in one call.
--   0: artist2+sd2, fee only in `data.fee` (sheet) -> created, fee_amount from data
--   1: artist1+sd1, duplicates the pre-seeded active order -> skipped_existing
--   2: artist_id is not a valid uuid -> per-row error, must NOT abort the batch
--   3: unlinked (no artist_id/show_date_id) -> created (unlinked rows are never deduped)
--   4: unlinked, BOTH an explicit fee_amount and a data.fee.value -> explicit wins
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE batch_result AS
SELECT public.bulk_import_hire_orders(
  '00000000-0000-0000-0000-0000000b10a1',
  '{"source":"xlsx","file_name":"roster.xlsx","mapping":{"artist_name":"Name","fee":"Fee"},"row_count":5}'::jsonb,
  '[
    {"row_index":0,"artist_id":"bbbbbbbb-b100-0002-0000-000000000000","show_date_id":"dddddddd-b100-0002-0000-000000000000",
     "data":{"date":{"value":"2099-10-02","source":"sheet"},"fee":{"value":"4500.00","source":"sheet"},"artist_name":{"value":"Bulk Artist Two","source":"sheet"}},
     "fee_currency":"EUR","terms_variant":"standard"},
    {"row_index":1,"artist_id":"bbbbbbbb-b100-0001-0000-000000000000","show_date_id":"dddddddd-b100-0001-0000-000000000000",
     "data":{"date":{"value":"2099-10-01","source":"sheet"}},
     "fee_currency":"EUR","terms_variant":"standard"},
    {"row_index":2,"artist_id":"not-a-uuid","show_date_id":null,"data":{},"fee_currency":"EUR","terms_variant":"standard"},
    {"row_index":3,"data":{"date":{"value":"2099-10-03","source":"manual"},"artist_name":{"value":"Walk-in","source":"manual"}},
     "fee_currency":"USD","terms_variant":"lean"},
    {"row_index":4,"fee_amount":999.99,"data":{"fee":{"value":"111.11","source":"sheet"}},"fee_currency":"GBP","terms_variant":"full"}
  ]'::jsonb
) AS results;
RESET ROLE;

SELECT is(
  ((SELECT results FROM batch_result) -> 0 ->> 'status'),
  'created', 'row 0 (linked, sheet fee) is created');
SELECT isnt(
  ((SELECT results FROM batch_result) -> 0 ->> 'order_id'),
  NULL, 'row 0 carries an order_id');
SELECT is(
  ((SELECT results FROM batch_result) -> 1 ->> 'status'),
  'skipped_existing', 'row 1 (dup of the pre-seeded active order) is skipped_existing');
SELECT is(
  ((SELECT results FROM batch_result) -> 2 ->> 'status'),
  'error', 'row 2 (malformed artist_id) records a per-row error');
SELECT isnt(
  ((SELECT results FROM batch_result) -> 2 ->> 'error'),
  NULL, 'row 2''s error message is captured');
SELECT is(
  ((SELECT results FROM batch_result) -> 3 ->> 'status'),
  'created', 'row 3 (unlinked) is created despite row 2''s error (batch not aborted)');
SELECT is(
  ((SELECT results FROM batch_result) -> 4 ->> 'status'),
  'created', 'row 4 (unlinked, explicit fee_amount) is created');

-- ────────────────────────────────────────────────────────────────────────────
-- hire_order_imports row was written once for this call.
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.hire_order_imports
   WHERE org_id = '00000000-0000-0000-0000-0000000b10a1' AND file_name = 'roster.xlsx'),
  1, 'exactly one hire_order_imports row was inserted for the batch');

-- ────────────────────────────────────────────────────────────────────────────
-- The 3 created rows (0, 3, 4) all carry the import_id and status='draft'.
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders ho
   JOIN public.hire_order_imports i ON i.id = ho.import_id
   WHERE i.org_id = '00000000-0000-0000-0000-0000000b10a1' AND i.file_name = 'roster.xlsx'),
  3, 'all 3 created rows carry the import_id back to the hire_order_imports row');
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders ho
   JOIN public.hire_order_imports i ON i.id = ho.import_id
   WHERE i.org_id = '00000000-0000-0000-0000-0000000b10a1' AND i.file_name = 'roster.xlsx' AND ho.status = 'draft'),
  3, 'all 3 created rows have status = draft');

-- ────────────────────────────────────────────────────────────────────────────
-- Row 0's created hire_order: fee resolved from data.fee (sheet), correct
-- currency/terms, and its data carries source='sheet' for the fee field.
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT fee_amount FROM public.hire_orders WHERE id = (((SELECT results FROM batch_result) -> 0 ->> 'order_id'))::uuid),
  4500.00, 'row 0''s fee_amount was derived from data.fee.value (4500.00)');
SELECT is(
  (SELECT data->'fee'->>'source' FROM public.hire_orders WHERE id = (((SELECT results FROM batch_result) -> 0 ->> 'order_id'))::uuid),
  'sheet', 'row 0''s stored data->fee->source is "sheet" (data is stored as-is, not re-resolved)');
SELECT is(
  (SELECT fee_currency FROM public.hire_orders WHERE id = (((SELECT results FROM batch_result) -> 0 ->> 'order_id'))::uuid),
  'EUR', 'row 0''s fee_currency is stored from the row payload');

-- ────────────────────────────────────────────────────────────────────────────
-- Row 4: an explicit row.fee_amount wins over data.fee.value.
-- ────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT fee_amount FROM public.hire_orders WHERE id = (((SELECT results FROM batch_result) -> 4 ->> 'order_id'))::uuid),
  999.99, 'row 4''s explicit fee_amount (999.99) wins over data.fee.value (111.11)');

-- ────────────────────────────────────────────────────────────────────────────
-- Order numbering: default settings (no hire_order_numbering row seeded) fall
-- back to prefix HO / pattern {prefix}-{yyyy}-{mmdd}-{seq}.
-- ────────────────────────────────────────────────────────────────────────────
SELECT matches(
  (SELECT order_no FROM public.hire_orders WHERE id = (((SELECT results FROM batch_result) -> 0 ->> 'order_id'))::uuid),
  '^HO-2099-1002-\d+$', 'row 0''s order_no follows the default HO-{yyyy}-{mmdd}-{seq} pattern for its date');

-- ────────────────────────────────────────────────────────────────────────────
-- Unlinked rows are NEVER deduped: importing the exact same unlinked payload a
-- second time still creates a new row rather than skipping it.
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT is(
  (public.bulk_import_hire_orders(
     '00000000-0000-0000-0000-0000000b10a1',
     '{"source":"csv","file_name":"repeat.csv","mapping":{},"row_count":1}'::jsonb,
     '[{"row_index":0,"data":{"date":{"value":"2099-10-03","source":"manual"},"artist_name":{"value":"Walk-in","source":"manual"}},"fee_currency":"USD","terms_variant":"lean"}]'::jsonb
   ) -> 0 ->> 'status'),
  'created', 'importing the same unlinked row content again still creates a new order (unlinked rows are never deduped)');
RESET ROLE;

-- Re-importing the SAME linked (artist1, sd1) row a second time is now
-- skipped_existing against the row THIS call itself just created (row 1 above
-- was skipped against the pre-seeded row, which is still the only active
-- order on that pair since row 1 was never created).
SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT is(
  (public.bulk_import_hire_orders(
     '00000000-0000-0000-0000-0000000b10a1',
     '{"source":"csv","file_name":"repeat2.csv","mapping":{},"row_count":1}'::jsonb,
     '[{"row_index":0,"artist_id":"bbbbbbbb-b100-0001-0000-000000000000","show_date_id":"dddddddd-b100-0001-0000-000000000000","data":{},"fee_currency":"EUR","terms_variant":"standard"}]'::jsonb
   ) -> 0 ->> 'status'),
  'skipped_existing', 'a linked row still dedupes correctly on a fresh call against the pre-seeded active order');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
