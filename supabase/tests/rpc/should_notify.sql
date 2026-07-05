-- should_notify: defaults true; respects an explicit false; per channel.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000009a0','authenticated','authenticated','np@x.com',now(),'{"provider":"email"}','{}',now(),now());
SET session_replication_role = DEFAULT;

SELECT ok(public.should_notify('00000000-0000-0000-0000-0000000009a0','booking_offers','email'),
  'no row -> enabled');

INSERT INTO public.notification_preferences (user_id, prefs)
VALUES ('00000000-0000-0000-0000-0000000009a0',
        '{"booking_offers":{"email":false}}'::jsonb);

SELECT ok(NOT public.should_notify('00000000-0000-0000-0000-0000000009a0','booking_offers','email'),
  'explicit false -> disabled');
SELECT ok(public.should_notify('00000000-0000-0000-0000-0000000009a0','booking_offers','in_app'),
  'missing channel key -> enabled');
SELECT ok(public.should_notify('00000000-0000-0000-0000-0000000009a0','schedule_changes','email'),
  'missing category key -> enabled');

-- grant posture: no cross-user preference probing — only service_role (and the
-- SECURITY DEFINER gate_notification_pref trigger, which executes as owner and
-- is unaffected by these grants) may call it.
SELECT ok(NOT has_function_privilege('authenticated', 'public.should_notify(uuid,text,text)', 'execute'),
          'authenticated cannot execute');
SELECT ok(NOT has_function_privilege('anon', 'public.should_notify(uuid,text,text)', 'execute'),
          'anon cannot execute');
SELECT ok(has_function_privilege('service_role', 'public.should_notify(uuid,text,text)', 'execute'),
          'service_role can execute');

SELECT * FROM finish();
ROLLBACK;
