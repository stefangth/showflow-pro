-- Hire-order signing "fix-before-enable" hardening (PR #188), asserted against the
-- already-applied live schema. Three DB migrations are under test here:
--   20260723183038_hire_order_user_fks_set_null.sql        (GDPR erasure FKs + anonymize_user)
--   20260723183053_hire_orders_issue_snapshot.sql          (issue_snapshot column)
--   20260723183204_hire_order_electronic_countersign_gate.sql (electronic countersign gate)
--
-- Run: `supabase test db`, or via the execute_sql MCP wrapped in a rolled-back
-- transaction (schema is already applied to prod, so this asserts the live schema).
-- NOTE: pgtap's like() collides with the SQL LIKE keyword, so the definition checks
-- use ok(<expr> LIKE '%...%', '...') rather than like(...).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

-- ── Fixtures (seeded under replica so the derive/transition guard triggers and the
--    FK referential-action triggers don't interfere with internally-consistent seed
--    data; reset to DEFAULT before the UPDATE assertions so the transition trigger
--    fires). ────────────────────────────────────────────────────────────────────
SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('a1510000-0000-0000-0000-000000000000','authenticated','authenticated','ho-sign-hardening@x.com',now(),'{"provider":"email"}','{}',now(),now());

-- Org A runs in electronic countersign mode; org B has no countersign setting, so
-- get_org_setting falls back to the 'manual' default.
INSERT INTO public.organizations (id, name, slug) VALUES
  ('51510000-0000-0000-0000-000000000000','HoSignElec','ho-sign-elec'),
  ('52520000-0000-0000-0000-000000000000','HoSignManual','ho-sign-manual');

INSERT INTO public.app_settings (org_id, key, value) VALUES
  ('51510000-0000-0000-0000-000000000000','hire_order_countersign','{"mode":"electronic"}'::jsonb);

-- HO-ELEC-1 is created_by the seeded user (drives the behavioral anonymize below);
-- HO-ELEC-VOID exercises the gate's non-countersigned skip; HO-MANUAL-1 lives in the
-- manual-mode org.
INSERT INTO public.hire_orders (id, org_id, order_no, status, data, created_by) VALUES
  ('f1510000-0000-0000-0000-000000000001','51510000-0000-0000-0000-000000000000','HO-ELEC-1','issued','{}'::jsonb,'a1510000-0000-0000-0000-000000000000'),
  ('f1510000-0000-0000-0000-000000000002','51510000-0000-0000-0000-000000000000','HO-ELEC-VOID','issued','{}'::jsonb,NULL);
INSERT INTO public.hire_orders (id, org_id, order_no, status, data) VALUES
  ('f2520000-0000-0000-0000-000000000001','52520000-0000-0000-0000-000000000000','HO-MANUAL-1','issued','{}'::jsonb);

INSERT INTO public.hire_order_signatures (id, org_id, hire_order_id, signer_user_id, signer_name, method, signed_at, consent_text) VALUES
  ('a5510000-0000-0000-0000-000000000001','51510000-0000-0000-0000-000000000000','f1510000-0000-0000-0000-000000000001','a1510000-0000-0000-0000-000000000000','Sig Signer','typed',now(),'consent');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- T1: GDPR erasure. Both hire-order FKs to auth.users are ON DELETE SET NULL
-- (confdeltype 'n'), so a user who signed or created a hire order can still be
-- deleted, and anonymize_user proactively nulls both columns before deletion.
-- ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT confdeltype = 'n' FROM pg_constraint WHERE conname = 'hire_order_signatures_signer_user_id_fkey'),
  'hire_order_signatures.signer_user_id FK is ON DELETE SET NULL');
SELECT ok(
  (SELECT confdeltype = 'n' FROM pg_constraint WHERE conname = 'hire_orders_created_by_fkey'),
  'hire_orders.created_by FK is ON DELETE SET NULL');
SELECT ok(
  pg_get_functiondef('public.anonymize_user'::regproc) LIKE '%hire_order_signatures set signer_user_id = null%',
  'anonymize_user nulls hire_order_signatures.signer_user_id');
SELECT ok(
  pg_get_functiondef('public.anonymize_user'::regproc) LIKE '%hire_orders set created_by = null%',
  'anonymize_user nulls hire_orders.created_by');

-- ────────────────────────────────────────────────────────────────────────────
-- Electronic countersign gate: an electronic-mode order may only reach
-- 'countersigned' through the audited sign action, which sets signed_pdf_path in the
-- same UPDATE. A bare "mark countersigned" that leaves signed_pdf_path null is
-- rejected, so the signature/audit flow cannot be bypassed. Manual-mode orders are
-- unaffected, and the gate only fires on the ->countersigned transition.
-- ────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $q$UPDATE public.hire_orders SET status = 'countersigned' WHERE id = 'f1510000-0000-0000-0000-000000000001'$q$,
  'P0001', 'electronic hire orders must be countersigned through the signature flow',
  'electronic mode: marking countersigned without signed_pdf_path is rejected');
SELECT lives_ok(
  $q$UPDATE public.hire_orders SET status = 'countersigned', signed_pdf_path = '51510000-0000-0000-0000-000000000000/HO-ELEC-1-signed.pdf' WHERE id = 'f1510000-0000-0000-0000-000000000001'$q$,
  'electronic mode: countersigning with signed_pdf_path set (the sign path) is allowed');
SELECT lives_ok(
  $q$UPDATE public.hire_orders SET status = 'countersigned' WHERE id = 'f2520000-0000-0000-0000-000000000001'$q$,
  'manual mode (default, no setting): marking countersigned without signed_pdf_path is allowed');
SELECT lives_ok(
  $q$UPDATE public.hire_orders SET status = 'void' WHERE id = 'f1510000-0000-0000-0000-000000000002'$q$,
  'electronic mode: issued -> void is unaffected by the countersign gate');

-- ────────────────────────────────────────────────────────────────────────────
-- Behavioral GDPR check (bonus): anonymize_user, run as the user themselves
-- (auth.uid() = p_user), actually clears signer_user_id + created_by while the
-- denormalized signer_name stays on the audit row. HO-ELEC-1 is now countersigned
-- (from the sign-path assertion above), proving the nulling is not blocked by the
-- issued/countersigned freeze (created_by is not a frozen column).
-- ────────────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', 'a1510000-0000-0000-0000-000000000000', 'role', 'authenticated')::text, true);
SELECT public.anonymize_user('a1510000-0000-0000-0000-000000000000');

SELECT is(
  (SELECT signer_user_id FROM public.hire_order_signatures WHERE id = 'a5510000-0000-0000-0000-000000000001'),
  NULL::uuid, 'anonymize_user cleared hire_order_signatures.signer_user_id (trail keeps signer_name)');
SELECT is(
  (SELECT created_by FROM public.hire_orders WHERE id = 'f1510000-0000-0000-0000-000000000001'),
  NULL::uuid, 'anonymize_user cleared hire_orders.created_by');

SELECT * FROM finish();
ROLLBACK;
