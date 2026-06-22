-- export_my_data: returns the caller's rows; arrays default to []; has schema_version.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000aa0','authenticated','authenticated','ex@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-000000000aa0','Exie');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000aa0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is((public.export_my_data() -> 'account' ->> 'display_name'), 'Exie', 'account block present');
SELECT is((public.export_my_data() -> 'artists')::text, '[]', 'no artists -> empty array');
SELECT is((public.export_my_data() ->> 'schema_version'), '1', 'has schema_version');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
