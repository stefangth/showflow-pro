-- supabase/tests/rpc/list_org_members.sql
-- list_org_members returns members with their last_sign_in_at (admin-guarded).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(2);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000006ad','authenticated','authenticated','adm@x.com',now(),'2026-06-01T10:00:00Z','{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000006c0','Roster','roster-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000006c0','00000000-0000-0000-0000-0000000006ad','admin');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000006ad","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.list_org_members('00000000-0000-0000-0000-0000000006c0')),
  1::bigint, 'returns the org member');
SELECT is(
  (SELECT last_sign_in_at FROM public.list_org_members('00000000-0000-0000-0000-0000000006c0')),
  '2026-06-01T10:00:00Z'::timestamptz, 'returns last_sign_in_at');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
