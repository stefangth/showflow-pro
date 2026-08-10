-- Tests for public.revoke_invitation(p_id): status flip + membership removal + gates.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('dddddddd-dddd-d101-0000-000000000000','authenticated','authenticated','rev-admin@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d102-0000-000000000000','authenticated','authenticated','rev-invitee@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d103-0000-000000000000','authenticated','authenticated','rev-outsider@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d104-0000-000000000000','authenticated','authenticated','rev-super@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d105-0000-000000000000','authenticated','authenticated','rev-invitee2@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000d1001','Revoke Org','revoke-org');
-- A super-admin who is NOT a member of the org (the platform OrgInvitePopover path).
INSERT INTO public.platform_admins (user_id) VALUES ('dddddddd-dddd-d104-0000-000000000000');
INSERT INTO public.org_memberships (org_id, user_id, role)
VALUES ('00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d101-0000-000000000000','admin');
-- Invite-time memberships already exist for the two invitees.
INSERT INTO public.org_memberships (org_id, user_id, role)
VALUES
  ('00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d102-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d105-0000-000000000000','artist');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000d111','00000000-0000-0000-0000-0000000d1001','rev-invitee@test.com','producer','tok-rev','pending');
-- A second pending invite the non-member super-admin will revoke.
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000d113','00000000-0000-0000-0000-0000000d1001','rev-invitee2@test.com','artist','tok-rev2','pending');
-- An already-accepted invitation must be un-revokable (would otherwise strip membership).
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000d112','00000000-0000-0000-0000-0000000d1001','rev-invitee@test.com','artist','tok-rev-acc','accepted');
-- An artist row ensure_invitation_membership claimed for invitee2 at invite time (by email);
-- revoking the still-pending artist invite must un-claim it, not strand it linked to a stranger.
INSERT INTO public.artists (id, org_id, user_id, email, name)
VALUES ('00000000-0000-0000-0000-0000000a1105','00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d105-0000-000000000000','rev-invitee2@test.com','Rev Invitee2');
SET session_replication_role = DEFAULT;

-- 1. A non-admin outsider cannot revoke (gate fires before the status guard).
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d103-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d111') $$,'42501', NULL, 'outsider cannot revoke');
RESET ROLE;
-- 2. The org admin revokes successfully.
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d101-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d111') $$,'admin revokes');
RESET ROLE;
-- 3. Invitation is revoked.
SELECT is((SELECT status FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000d111'),'revoked','invitation marked revoked');
-- 4. The invite-created membership was removed.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000d1001' AND user_id='dddddddd-dddd-d102-0000-000000000000' AND role='producer'),
  0, 'invite-created membership removed on revoke');
-- 5. The admin's own membership is untouched.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000d1001' AND user_id='dddddddd-dddd-d101-0000-000000000000' AND role='admin'),
  1, 'admin membership untouched');
-- 6. An already-accepted invitation cannot be revoked (no membership stripping).
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d101-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d112') $$,'P0001', NULL,'cannot revoke an accepted invitation');
RESET ROLE;
-- 7. A non-member super-admin can revoke (the platform OrgInvitePopover path).
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d104-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d113') $$,'non-member super-admin revokes');
RESET ROLE;
-- 8. The second invitee's invite-created membership was removed by the super-admin revoke.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000d1001' AND user_id='dddddddd-dddd-d105-0000-000000000000' AND role='artist'),
  0, 'super-admin revoke removed the invite-created membership');
-- 9. That revoke also un-claimed the artist row (the invitee has no remaining membership), so
--    no catalog artist is left pointing at a now-stranger.
SELECT is(
  (SELECT user_id FROM public.artists WHERE id='00000000-0000-0000-0000-0000000a1105'),
  NULL, 'revoke un-claimed the invite-linked artist when no membership remains');

SELECT * FROM finish();
ROLLBACK;
