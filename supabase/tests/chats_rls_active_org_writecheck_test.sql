-- Regression: the active-org conjunct in the RESTRICTIVE org_isolation WITH CHECK
-- (migration 20260806104215_active_org_scoping.sql) blocks legitimate INSERTs.
--
-- A multi-org member (admin of BOTH org A and org B) creating a chat for an
-- org-A show_date while their SPA active-org header (x-active-org) points at
-- org B is rejected: the chats BEFORE INSERT trigger derives org_id from the
-- show_date (org A), and org_isolation's WITH CHECK then demands
-- org_id = active_org_id() (org B) → `new row violates row-level security
-- policy for table "chats"`. Same latent write bug exists on all 29 tenant
-- tables the buggy migration rewrote.
--
-- Fix under test: recreate org_isolation with the active-org conjunct removed
-- from WITH CHECK only (kept on USING). is_org_member(auth.uid(), org_id)
-- already restricts writes to orgs the caller belongs to, and the derive
-- trigger stamps org_id from the FK parent, so a cross-org row cannot be forged.
--
-- This file MUST fail (step "regression") on the current prod schema and pass
-- after the new migration's DDL is applied.
--
-- UUID legend (all rolled back at the end):
--   aaaaaaaa-aaaa-0a0b-…  user, admin member of BOTH org A and org B
--   00000000-…-0000000000aa  org A
--   00000000-…-0000000000bb  org B
--   cccccccc-cccc-000a-…  show (org A)
--   dddddddd-dddd-000a-…  show_date (org A)
--   ffffffff-ffff-000a-…  chat under test (org A show_date)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

-- ── Fixture setup (triggers disabled so seeding bypasses RLS/derive) ──
SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0a0b-0000-000000000000','authenticated','authenticated','wc-multiorg@test.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000000aa','WC Org A','wc-org-a'),
  ('00000000-0000-0000-0000-0000000000bb','WC Org B','wc-org-b');

-- The same human is an admin of BOTH orgs (multi-org member, NOT a super-admin).
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000aa','aaaaaaaa-aaaa-0a0b-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-0000000000bb','aaaaaaaa-aaaa-0a0b-0000-000000000000','admin');

-- A show + show_date in org A.
INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('cccccccc-cccc-000a-0000-000000000000','theatre','musical','00000000-0000-0000-0000-0000000000aa');

INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-dddd-000a-0000-000000000000','cccccccc-cccc-000a-0000-000000000000','2099-03-01','20:00'::time,'00000000-0000-0000-0000-0000000000aa');

SET session_replication_role = DEFAULT;

-- ── 1. Regression: INSERT a chat for the org-A show_date while the active-org
--       header points at org B. The derive trigger stamps org_id = org A;
--       org_isolation WITH CHECK must NOT reject it on the active-org mismatch. ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0a0b-0000-000000000000","role":"authenticated"}',true);
SELECT set_config('request.headers','{"x-active-org":"00000000-0000-0000-0000-0000000000bb"}',true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.chats (id, show_date_id, org_id)
    VALUES (
      'ffffffff-ffff-000a-0000-000000000000',
      'dddddddd-dddd-000a-0000-000000000000',
      '00000000-0000-0000-0000-0000000000aa'
    )$$,
  'multi-org admin can create a chat for an org-A show_date while active-org header = org B (WITH CHECK must not enforce active-org)'
);

RESET ROLE;

-- ── 2. Read-narrowing preserved: still viewing org B, the org-A chat is NOT
--       visible (org_isolation USING must still narrow reads to the active org). ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0a0b-0000-000000000000","role":"authenticated"}',true);
SELECT set_config('request.headers','{"x-active-org":"00000000-0000-0000-0000-0000000000bb"}',true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chats WHERE id = 'ffffffff-ffff-000a-0000-000000000000'),
  0,
  'read-narrowing preserved: org-A chat is NOT visible while active-org header = org B (USING still narrows)'
);

RESET ROLE;

-- ── 3. Guard against over-correction / silent no-op INSERT: switching the
--       active-org header to org A makes the same row visible (count 1),
--       proving the row was actually written and USING narrows correctly. ──
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0a0b-0000-000000000000","role":"authenticated"}',true);
SELECT set_config('request.headers','{"x-active-org":"00000000-0000-0000-0000-0000000000aa"}',true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chats WHERE id = 'ffffffff-ffff-000a-0000-000000000000'),
  1,
  'the org-A chat IS visible while active-org header = org A (row was written; USING narrows correctly)'
);

RESET ROLE;
SELECT set_config('request.headers','',true);

SELECT * FROM finish();
ROLLBACK;
