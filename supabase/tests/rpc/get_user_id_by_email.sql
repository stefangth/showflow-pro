-- get_user_id_by_email: case-insensitive + trimmed resolution; null for unknown;
-- not executable by a normal authenticated user (no email-enumeration oracle).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000000e0','authenticated','authenticated','Found@X.com',now(),'{"provider":"email"}','{}',now(),now());
SET session_replication_role = DEFAULT;

SELECT is(public.get_user_id_by_email('found@x.com'),
          '00000000-0000-0000-0000-0000000000e0'::uuid, 'resolves case-insensitively');
SELECT is(public.get_user_id_by_email('  FOUND@X.COM  '),
          '00000000-0000-0000-0000-0000000000e0'::uuid, 'trims whitespace + matches uppercased');
SELECT ok(public.get_user_id_by_email('nobody@x.com') IS NULL, 'unknown email -> null');

-- grant posture: only the service role may execute it (no enumeration oracle for users)
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_user_id_by_email(text)', 'execute'),
          'authenticated cannot execute');
SELECT ok(has_function_privilege('service_role', 'public.get_user_id_by_email(text)', 'execute'),
          'service_role can execute');

SELECT * FROM finish();
ROLLBACK;
