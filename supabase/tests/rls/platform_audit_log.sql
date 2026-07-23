-- RLS on public.platform_audit_log: only super-admins may read or insert.
--   11111111…1111 super-admin (in platform_admins)
--   22222222…2222 regular user
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','sa@test.com',now(),now()),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','reg@test.com',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('11111111-1111-1111-1111-111111111111');
SET session_replication_role = DEFAULT;

-- 1. regular user cannot insert
SELECT set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.platform_audit_log(actor_user_id, action) VALUES ('22222222-2222-2222-2222-222222222222','x') $$,
  '42501', null, 'regular user cannot insert into platform_audit_log');
RESET ROLE;

-- 2. super-admin can insert
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ INSERT INTO public.platform_audit_log(actor_user_id, action) VALUES ('11111111-1111-1111-1111-111111111111','change_email') $$,
  'super-admin can insert');
-- 3. super-admin can read
SELECT isnt_empty(
  $$ SELECT 1 FROM public.platform_audit_log $$,
  'super-admin can read the audit log');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
