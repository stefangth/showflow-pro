-- anonymize_user: artists anonymized, audit performed_by nulled, profile gone,
-- audit ROW retained, and non-owner/non-super-admin rejected.
-- NOTE: chat_messages.user_id is NOT NULL; the function deletes messages rather than
-- nulling the column (test adapted accordingly).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000bb0','authenticated','authenticated','self@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000bb1','authenticated','authenticated','other@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000bc0','AnonOrg','anon-org');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-000000000bb0','Self');
INSERT INTO public.artists (id, org_id, name, email, user_id)
VALUES ('00000000-0000-0000-0000-000000000bd0','00000000-0000-0000-0000-000000000bc0','Self Talent','self@x.com','00000000-0000-0000-0000-000000000bb0');
INSERT INTO public.booking_audit_log (id, org_id, action, performed_by)
VALUES ('00000000-0000-0000-0000-000000000be0','00000000-0000-0000-0000-000000000bc0','status_change','00000000-0000-0000-0000-000000000bb0');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000bb1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.anonymize_user('00000000-0000-0000-0000-000000000bb0') $$,
  '42501', NULL, 'non-owner cannot anonymize another user');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000bb0","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.anonymize_user('00000000-0000-0000-0000-000000000bb0') $$, 'owner can anonymize self');
RESET ROLE;

SELECT is((SELECT name FROM public.artists WHERE id='00000000-0000-0000-0000-000000000bd0'),
          'Deleted artist', 'artist name anonymized');
SELECT ok((SELECT user_id FROM public.artists WHERE id='00000000-0000-0000-0000-000000000bd0') IS NULL,
          'artist unlinked');
SELECT ok(EXISTS(SELECT 1 FROM public.booking_audit_log WHERE id='00000000-0000-0000-0000-000000000be0'
                 AND performed_by IS NULL),
          'audit row retained with performed_by nulled');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id='00000000-0000-0000-0000-000000000bb0'),
          'profile deleted');

SELECT * FROM finish();
ROLLBACK;
