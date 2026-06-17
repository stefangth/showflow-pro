-- supabase/tests/rpc/resolve_user_contacts.sql
-- resolve_user_contacts: returns login email + profile display_name by user_id,
-- and is NOT executable by `authenticated` (it reads auth.users).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
-- u1 has a profile with a display name; u2 has an auth user but NO profile row.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('cccccccc-0000-4000-a000-000000000001','authenticated','authenticated','login1@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('cccccccc-0000-4000-a000-000000000002','authenticated','authenticated','login2@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.profiles (user_id, display_name)
VALUES ('cccccccc-0000-4000-a000-000000000001','Ada Lovelace')
ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name;
SET session_replication_role = DEFAULT;

-- 1 & 2. user WITH a profile → returns auth email + profile display_name.
SELECT is(
  (SELECT email FROM public.resolve_user_contacts(ARRAY['cccccccc-0000-4000-a000-000000000001']::uuid[])),
  'login1@test.com', 'returns the auth email for a known user');
SELECT is(
  (SELECT display_name FROM public.resolve_user_contacts(ARRAY['cccccccc-0000-4000-a000-000000000001']::uuid[])),
  'Ada Lovelace', 'returns the profile display_name');

-- 3. user WITHOUT a profile → email present, display_name null.
SELECT is(
  (SELECT display_name FROM public.resolve_user_contacts(ARRAY['cccccccc-0000-4000-a000-000000000002']::uuid[])),
  NULL, 'display_name is null when no profile row exists');

-- 4 & 5. privilege: authenticated cannot execute; service_role can.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.resolve_user_contacts(uuid[])', 'EXECUTE'),
  'authenticated cannot execute resolve_user_contacts');
SELECT ok(
  has_function_privilege('service_role', 'public.resolve_user_contacts(uuid[])', 'EXECUTE'),
  'service_role can execute resolve_user_contacts');

SELECT * FROM finish();
ROLLBACK;
