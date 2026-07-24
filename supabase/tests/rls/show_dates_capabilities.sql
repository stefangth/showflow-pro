-- pgTAP: capability-aware write RLS on public.show_dates (Plan 3, Phase 1.2).
-- Producer INSERT/UPDATE gated on producer_can_manage_show_dates, DELETE on
-- producer_can_hard_delete_show_dates; admin always; SELECT always (floor).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0002-4001-8001-000000000001','authenticated','authenticated','sd-admin@t.com',now(),now()),
  ('11111111-0002-4001-8001-000000000002','authenticated','authenticated','sd-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0002-4001-8001-000000000001','SdOrg','sd-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0002-4001-8001-000000000001','11111111-0002-4001-8001-000000000001','admin'),
  ('22222222-0002-4001-8001-000000000001','11111111-0002-4001-8001-000000000002','producer');
INSERT INTO public.shows (id, org_id) VALUES ('33333333-0002-4001-8001-000000000001','22222222-0002-4001-8001-000000000001');
INSERT INTO public.show_dates (id, show_id, date, org_id) VALUES
  ('44444444-0002-4001-8001-000000000001','33333333-0002-4001-8001-000000000001','2026-08-01','22222222-0002-4001-8001-000000000001'),
  ('44444444-0002-4001-8001-000000000002','33333333-0002-4001-8001-000000000001','2026-08-02','22222222-0002-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (manage_show_dates on by default, hard_delete off).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0002-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ insert into public.show_dates (show_id, date, org_id) values ('33333333-0002-4001-8001-000000000001','2026-08-10','22222222-0002-4001-8001-000000000001') $$,
  'producer INSERT allowed when manage on');
SELECT isnt_empty($$ select 1 from public.show_dates where org_id='22222222-0002-4001-8001-000000000001' $$, 'producer SELECT always works');
UPDATE public.show_dates SET notes='on1' WHERE id='44444444-0002-4001-8001-000000000001';
SELECT is(
  (SELECT notes FROM public.show_dates WHERE id='44444444-0002-4001-8001-000000000001'),
  'on1', 'producer UPDATE applied when manage on');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled)
  VALUES ('22222222-0002-4001-8001-000000000001','producer_can_manage_show_dates',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0002-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ insert into public.show_dates (show_id, date, org_id) values ('33333333-0002-4001-8001-000000000001','2026-08-11','22222222-0002-4001-8001-000000000001') $$,
  '42501', NULL, 'producer INSERT denied when manage off');
UPDATE public.show_dates SET notes='off1' WHERE id='44444444-0002-4001-8001-000000000001';
SELECT is(
  (SELECT notes FROM public.show_dates WHERE id='44444444-0002-4001-8001-000000000001'),
  'on1', 'producer UPDATE no-op when manage off (row unchanged)');
DELETE FROM public.show_dates WHERE id='44444444-0002-4001-8001-000000000001';
SELECT isnt_empty($$ select 1 from public.show_dates where id='44444444-0002-4001-8001-000000000001' $$, 'producer DELETE no-op when hard_delete off');
RESET ROLE;

SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled)
  VALUES ('22222222-0002-4001-8001-000000000001','producer_can_hard_delete_show_dates',true);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0002-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.show_dates WHERE id='44444444-0002-4001-8001-000000000001';
SELECT is_empty($$ select 1 from public.show_dates where id='44444444-0002-4001-8001-000000000001' $$, 'producer DELETE allowed when hard_delete on');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0002-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.show_dates WHERE id='44444444-0002-4001-8001-000000000002';
SELECT is_empty($$ select 1 from public.show_dates where id='44444444-0002-4001-8001-000000000002' $$, 'admin DELETE always allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
