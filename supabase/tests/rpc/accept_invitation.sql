-- Tests for public.accept_invitation(token): invite-based onboarding.
--   aaaa…ac01 invitee A (email matches the invitation)
--   aaaa…ac02 user B    (email does NOT match)
--   0000…ac001 org
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-ac01-0000-000000000000','authenticated','authenticated','accept-a@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-ac02-0000-000000000000','authenticated','authenticated','accept-b@test.com', now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000ac001','Accept Org','accept-org');

INSERT INTO public.org_invitations (org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-0000000ac001','accept-a@test.com','producer','tok-accept-aaa','pending');

SET session_replication_role = DEFAULT;

-- 1. Wrong-email user cannot accept (token issued to a@, caller is b@)
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac02-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.accept_invitation('tok-accept-aaa') $$,
  '42501', null, 'invitee with mismatched email is rejected');
RESET ROLE;

-- 2. Invalid token is rejected
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac01-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.accept_invitation('does-not-exist') $$,
  'P0002', null, 'invalid token is rejected');
RESET ROLE;

-- 3. Correct invitee accepts successfully
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac01-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.accept_invitation('tok-accept-aaa') $$,
  'correct invitee accepts the invitation');
RESET ROLE;

-- 4. Membership was created
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE user_id = 'aaaaaaaa-aaaa-ac01-0000-000000000000'
     AND org_id = '00000000-0000-0000-0000-0000000ac001'
     AND role = 'producer'),
  1, 'accepting creates the org_membership');

-- 5. Invitation is now marked accepted
SELECT is(
  (SELECT status FROM public.org_invitations WHERE token = 'tok-accept-aaa'),
  'accepted', 'invitation is marked accepted');

-- 6. The same token cannot be reused
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac01-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.accept_invitation('tok-accept-aaa') $$,
  'P0002', null, 'an accepted invitation cannot be reused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
