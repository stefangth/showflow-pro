-- pgTAP: RLS coverage for public.show_dates.cast_notified_at (the "Needs you"
-- queue's Notify-cast marker, added alongside the notify-cast edge function).
-- The column rides the existing "Admins and producers can update show_dates"
-- UPDATE policy (+ org_isolation RESTRICTIVE gate) — no new policy was added,
-- so this pins that a same-org producer can write it and a foreign-org member
-- cannot.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(2);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0003-4001-8001-000000000001','authenticated','authenticated','nc-prod@t.com',now(),now()),
  ('11111111-0003-4001-8001-000000000002','authenticated','authenticated','nc-foreign@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-0003-4001-8001-000000000001','NcOrg','nc-cap-org'),
  ('22222222-0003-4001-8001-000000000002','NcForeignOrg','nc-cap-foreign-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0003-4001-8001-000000000001','11111111-0003-4001-8001-000000000001','producer'),
  ('22222222-0003-4001-8001-000000000002','11111111-0003-4001-8001-000000000002','producer');
INSERT INTO public.shows (id, org_id) VALUES ('33333333-0003-4001-8001-000000000001','22222222-0003-4001-8001-000000000001');
INSERT INTO public.show_dates (id, show_id, date, org_id, status, cancellation_reason) VALUES
  ('44444444-0003-4001-8001-000000000001','33333333-0003-4001-8001-000000000001','2026-08-01','22222222-0003-4001-8001-000000000001','cancelled','date_cancelled');
SET session_replication_role = DEFAULT;

-- A same-org producer can stamp cast_notified_at on their own org's cancelled date.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0003-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.show_dates SET cast_notified_at = now() WHERE id = '44444444-0003-4001-8001-000000000001';
SELECT isnt(
  (SELECT cast_notified_at FROM public.show_dates WHERE id = '44444444-0003-4001-8001-000000000001'),
  NULL,
  'same-org producer UPDATE stamps cast_notified_at');
RESET ROLE;

-- Reset the marker so the next check starts from a known null state.
SET session_replication_role = replica;
UPDATE public.show_dates SET cast_notified_at = NULL WHERE id = '44444444-0003-4001-8001-000000000001';
SET session_replication_role = DEFAULT;

-- A member of a DIFFERENT org cannot affect this row (org_isolation RESTRICTIVE
-- gate + the base UPDATE policy's org-membership check — the write is a no-op).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0003-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.show_dates SET cast_notified_at = now() WHERE id = '44444444-0003-4001-8001-000000000001';
SELECT is(
  (SELECT cast_notified_at FROM public.show_dates WHERE id = '44444444-0003-4001-8001-000000000001'),
  NULL,
  'foreign-org producer UPDATE is a no-op (cast_notified_at stays null)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
