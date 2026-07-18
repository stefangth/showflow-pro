-- bulk_import_hire_orders(p_org, p_import, p_rows): producer/admin-guarded,
-- hire_orders-entitlement-gated SECURITY DEFINER bulk insert of DRAFT hire
-- orders from an already-resolved import sheet. Inserts one hire_order_imports
-- row, then loops p_rows creating one hire_orders draft per row -- each row
-- wrapped in its OWN begin/exception block (unlike bulk_import_artists' loop,
-- which has no per-row exception capture) so a malformed row records a
-- per-row 'error' without aborting the batch. Dedup: a row whose
-- (artist_id, show_date_id) already carries an active (non-void) hire order
-- is 'skipped_existing' -- but ONLY when both links are present; unlinked
-- rows are never deduped. The pre-check SELECT EXISTS is a fast-path
-- optimization; hire_orders_active_artist_date_uniq (a partial unique index,
-- mirroring bookings_active_artist_date_uniq) is the race-safe DB backstop --
-- see the tests near the bottom of this file. Order numbers are generated
-- in-function from the org's hire_order_numbering setting (default
-- HO-{yyyy}-{mmdd}-{seq}), with a unique_violation collision-suffix retry
-- loop that discriminates an order_no collision from an active-artist-date
-- conflict via GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(33);

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

-- ────────────────────────────────────────────────────────────────────────────
-- E1. Collision-suffix exhaustion -> per-row 'error', sibling row NOT aborted.
-- The RPC's collision retry tries attempts 0..19: attempt 0 = the bare base
-- order_no, attempts 1..19 = base || '-2' .. base || '-20' (20 distinct
-- strings total -- see the `for v_attempt in 0..19 loop` in
-- 20260718005949_bulk_import_hire_orders.sql). We pre-occupy exactly those 20
-- strings for the same org and the same data.date.value the imported row will
-- use, so the RPC's v_seq computes to the same base_order_no a 21st row on
-- that date would get -- and every one of its 20 attempts collides.
-- Variant implemented: FULL exhaustion (all 20 slots occupied), not the
-- documented "-2"-only fallback -- pre-seeding 20 rows directly (bypassing
-- the RPC) turned out to be cheap and unambiguous, so the fallback wasn't
-- needed.
-- ────────────────────────────────────────────────────────────────────────────
SET session_replication_role = replica;
INSERT INTO public.hire_orders (org_id, order_no, status, data)
SELECT '00000000-0000-0000-0000-0000000b10a1',
  CASE WHEN n = 1 THEN 'HO-2099-1101-21' ELSE 'HO-2099-1101-21-' || n END,
  'draft',
  '{"date":{"value":"2099-11-01","source":"manual"}}'::jsonb
FROM generate_series(1,20) AS n;
SET session_replication_role = DEFAULT;

SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE collision_result AS
SELECT public.bulk_import_hire_orders(
  '00000000-0000-0000-0000-0000000b10a1',
  '{"source":"csv","file_name":"collision.csv","mapping":{},"row_count":2}'::jsonb,
  '[
    {"row_index":0,"data":{"date":{"value":"2099-11-01","source":"manual"},"artist_name":{"value":"Collision Row","source":"manual"}},"fee_currency":"EUR","terms_variant":"standard"},
    {"row_index":1,"data":{"date":{"value":"2099-11-02","source":"manual"},"artist_name":{"value":"Sibling Row","source":"manual"}},"fee_currency":"EUR","terms_variant":"standard"}
  ]'::jsonb
) AS results;
RESET ROLE;

SELECT is(
  ((SELECT results FROM collision_result) -> 0 ->> 'status'),
  'error', 'E1: row 0, whose 20 candidate order_no slots are all pre-occupied, records a per-row error');
SELECT is(
  ((SELECT results FROM collision_result) -> 0 ->> 'error'),
  'order_no_collision', 'E1: row 0''s error is the order_no_collision sentinel');
SELECT is(
  ((SELECT results FROM collision_result) -> 1 ->> 'status'),
  'created', 'E1: sibling row 1 (different date, no collision) still created -- the batch was not aborted');
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders
   WHERE org_id = '00000000-0000-0000-0000-0000000b10a1' AND data->'date'->>'value' = '2099-11-01'),
  20, 'E1: no 21st row was created for the exhausted date -- still exactly the 20 pre-seeded rows');

-- ────────────────────────────────────────────────────────────────────────────
-- E2. Same-call {seq} advancement: two unlinked rows sharing one date/org in
-- a SINGLE bulk_import_hire_orders call get order_no values whose {seq}
-- component differs (...-1 then ...-2), not a collision suffix tacked onto an
-- identical base -- proving the in-transaction count(*) sees row 0's insert
-- before row 1's number is computed. Asserted via an EXACT match (not just
-- "differ"): if seq were NOT advancing, row 1 would collide with row 0's base
-- and fall back to the collision-suffix path instead, producing "...-1-2",
-- which fails the exact "...-2" match below.
-- ────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE seq_result AS
SELECT public.bulk_import_hire_orders(
  '00000000-0000-0000-0000-0000000b10a1',
  '{"source":"csv","file_name":"seq.csv","mapping":{},"row_count":2}'::jsonb,
  '[
    {"row_index":0,"data":{"date":{"value":"2099-12-01","source":"manual"},"artist_name":{"value":"Seq A","source":"manual"}},"fee_currency":"EUR","terms_variant":"standard"},
    {"row_index":1,"data":{"date":{"value":"2099-12-01","source":"manual"},"artist_name":{"value":"Seq B","source":"manual"}},"fee_currency":"EUR","terms_variant":"standard"}
  ]'::jsonb
) AS results;
RESET ROLE;

SELECT is(
  ((SELECT results FROM seq_result) -> 0 ->> 'status'),
  'created', 'E2: row 0 is created');
SELECT is(
  ((SELECT results FROM seq_result) -> 1 ->> 'status'),
  'created', 'E2: row 1 is created');
SELECT is(
  (SELECT order_no FROM public.hire_orders WHERE id = (((SELECT results FROM seq_result) -> 0 ->> 'order_id'))::uuid),
  'HO-2099-1201-1', 'E2: row 0''s order_no carries seq=1 (0 prior same-date orders)');
SELECT is(
  (SELECT order_no FROM public.hire_orders WHERE id = (((SELECT results FROM seq_result) -> 1 ->> 'order_id'))::uuid),
  'HO-2099-1201-2', 'E2: row 1''s order_no carries seq=2 -- the in-call count(*) already sees row 0''s insert, so this is NOT a "-2" collision suffix on an identical base');

-- ────────────────────────────────────────────────────────────────────────────
-- CI-review fix: the RPC's "one active order per (artist, show_date)" dedup
-- was a racy SELECT EXISTS + INSERT with no backing constraint. Mirrors
-- bookings_active_artist_date_uniq (20260616161112): a partial unique index
-- (20260718125647_hire_orders_active_artist_date_uniq.sql) now backs the
-- invariant at the DB level, and the RPC's insert loop discriminates the
-- resulting unique_violation from an order_no collision via
-- GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME (verified directly against the
-- live index: a plain partial unique index populates CONSTRAINT_NAME with the
-- index's own name, exactly like a table-level UNIQUE constraint does).
-- ────────────────────────────────────────────────────────────────────────────
SELECT has_index('public', 'hire_orders', 'hire_orders_active_artist_date_uniq',
  'hire_orders_active_artist_date_uniq index exists');

-- The invariant is DB-enforced independent of the RPC: a raw INSERT
-- duplicating the pre-seeded active (artist1, sd1) pair from a DIFFERENT
-- order_no (so it cannot be the order_no unique constraint firing) still
-- raises a unique_violation.
SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.hire_orders (org_id, order_no, status, artist_id, show_date_id, data)
     VALUES ('00000000-0000-0000-0000-0000000b10a1', 'HO-DIRECT-DUP-1', 'draft',
             'bbbbbbbb-b100-0001-0000-000000000000', 'dddddddd-b100-0001-0000-000000000000', '{}') $$,
  '23505', NULL,
  'a second active hire order for the SAME (org, artist, show_date) is rejected at the DB level');
RESET ROLE;

-- Same-call dedup, race-safe backstop exercised end-to-end: two rows in ONE
-- bulk_import_hire_orders call target a brand-new (artist, show_date) pair
-- (never imported before this call). Row 0 creates it; row 1 -- whose
-- pre-check SELECT EXISTS runs after row 0's insert is already visible within
-- the same transaction -- must not create a second active order for the pair
-- and reports skipped_existing rather than erroring or duplicating (proving
-- the invariant holds end-to-end for the exact "two rows, one call" shape a
-- racing import + the fully_filled auto-draft trigger could produce).
SELECT pg_temp.act_as('aaaaaaaa-b100-0001-0000-000000000000');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE samecall_result AS
SELECT public.bulk_import_hire_orders(
  '00000000-0000-0000-0000-0000000b10a1',
  '{"source":"csv","file_name":"samecall.csv","mapping":{},"row_count":2}'::jsonb,
  '[
    {"row_index":0,"artist_id":"bbbbbbbb-b100-0001-0000-000000000000","show_date_id":"dddddddd-b100-0002-0000-000000000000","data":{},"fee_currency":"EUR","terms_variant":"standard"},
    {"row_index":1,"artist_id":"bbbbbbbb-b100-0001-0000-000000000000","show_date_id":"dddddddd-b100-0002-0000-000000000000","data":{},"fee_currency":"EUR","terms_variant":"standard"}
  ]'::jsonb
) AS results;
RESET ROLE;

SELECT is(
  ((SELECT results FROM samecall_result) -> 0 ->> 'status'),
  'created', 'same-call dedup: first row for a brand-new (artist, date) pair is created');
SELECT is(
  ((SELECT results FROM samecall_result) -> 1 ->> 'status'),
  'skipped_existing', 'same-call dedup: second row for the SAME pair in the SAME call is skipped_existing, not a duplicate');
SELECT is(
  (SELECT count(*)::int FROM public.hire_orders
   WHERE org_id = '00000000-0000-0000-0000-0000000b10a1' AND status <> 'void'
     AND artist_id = 'bbbbbbbb-b100-0001-0000-000000000000'
     AND show_date_id = 'dddddddd-b100-0002-0000-000000000000'),
  1, 'exactly one active order exists for the pair after the same-call duplicate row');

SELECT * FROM finish();
ROLLBACK;
