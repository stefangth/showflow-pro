-- hire_order_signatures + signing-column schema tests.
-- Run: `supabase test db`, or via the execute_sql MCP wrapped in a rolled-back
-- transaction (per docs/superpowers/plans/2026-07-23-hire-orders-in-app-signing.md).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

-- New signing columns on hire_orders.
SELECT has_column('public','hire_orders','signed_pdf_path','signed_pdf_path column added');
SELECT has_column('public','hire_orders','issued_pdf_sha256','issued_pdf_sha256 column added');

-- countersign_mode check now allows 'electronic' (verified against the constraint
-- definition rather than a live INSERT, which would depend on a seeded org FK).
SELECT ok(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid='public.hire_orders'::regclass AND conname='hire_orders_countersign_mode_check') LIKE '%electronic%',
  'countersign_mode check now allows electronic');

-- hire_order_signatures table + shape.
SELECT has_table('public','hire_order_signatures','hire_order_signatures table exists');
SELECT col_is_pk('public','hire_order_signatures','id','id is the PK');
SELECT has_column('public','hire_order_signatures','document_sha256','document_sha256 column exists');
SELECT col_has_check('public','hire_order_signatures','method','method has a CHECK constraint');

-- RLS enabled + service-role-write-only (no permissive INSERT/ALL policy).
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.hire_order_signatures'::regclass),
  true, 'RLS is enabled on hire_order_signatures');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='public' AND tablename='hire_order_signatures'
       AND cmd IN ('INSERT','ALL') AND permissive='PERMISSIVE'),
  0, 'no permissive INSERT/ALL policy — authenticated clients cannot write the audit table');

SELECT * FROM finish();
ROLLBACK;
