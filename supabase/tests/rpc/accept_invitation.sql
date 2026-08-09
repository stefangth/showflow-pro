-- Tests for public.accept_invitation(token): invite-based onboarding.
--   aaaa…ac01 invitee A (email matches the invitation)
--   aaaa…ac02 user B    (email does NOT match)
--   0000…ac001 org
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

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

-- === Spec A: artist_id-first linking ===
-- Seeds a second org, three invitees (C owns nothing, D legacy, E already owns an
-- artist), and four artists. Exercises: id-stamped link, the no-op guard when the
-- caller already owns an artist in the org (would otherwise trip the
-- artists(org_id, user_id) partial-unique index), and the legacy email path.
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-ac03-0000-000000000000','authenticated','authenticated','accept-c@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-ac04-0000-000000000000','authenticated','authenticated','accept-d@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-ac05-0000-000000000000','authenticated','authenticated','accept-e@test.com', now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000ac002','Accept Org 2','accept-org-2');

-- a501 idd: unclaimed; linked by id (booking email deliberately != login email).
INSERT INTO public.artists (id, org_id, name, email, status) VALUES
  ('00000000-0000-0000-0000-00000000a501','00000000-0000-0000-0000-0000000ac002','Idd Artist','booking-only@test.com','active');
-- a502 owned: already owned by user E (drives the guard's no-op via double-ownership).
INSERT INTO public.artists (id, org_id, name, email, status, user_id) VALUES
  ('00000000-0000-0000-0000-00000000a502','00000000-0000-0000-0000-0000000ac002','Owned Artist','owned@test.com','active','aaaaaaaa-aaaa-ac05-0000-000000000000');
-- a503 legacy: unclaimed; matches user D by email.
INSERT INTO public.artists (id, org_id, name, email, status) VALUES
  ('00000000-0000-0000-0000-00000000a503','00000000-0000-0000-0000-0000000ac002','Legacy Artist','accept-d@test.com','active');
-- a504 other: unclaimed target of E's id-stamped invite (claim must no-op since E already owns a502).
INSERT INTO public.artists (id, org_id, name, email, status) VALUES
  ('00000000-0000-0000-0000-00000000a504','00000000-0000-0000-0000-0000000ac002','Other Artist','other@test.com','active');

INSERT INTO public.org_invitations (org_id, email, role, token, status, artist_id) VALUES
  ('00000000-0000-0000-0000-0000000ac002','accept-c@test.com','artist','tok-accept-ccc','pending','00000000-0000-0000-0000-00000000a501'),
  ('00000000-0000-0000-0000-0000000ac002','accept-e@test.com','artist','tok-accept-eee','pending','00000000-0000-0000-0000-00000000a504');
INSERT INTO public.org_invitations (org_id, email, role, token, status) VALUES
  ('00000000-0000-0000-0000-0000000ac002','accept-d@test.com','artist','tok-accept-ddd','pending');
SET session_replication_role = DEFAULT;

-- 7. User C (owns nothing) accepts the id-stamped invite.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac03-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.accept_invitation('tok-accept-ccc') ->> 'artist_linked'),
  'true',
  'id-stamped invitee links -> artist_linked true');
RESET ROLE;
-- 8. The exact artist is claimed by artist_id (even though its booking email differs).
SELECT is(
  (SELECT user_id FROM public.artists WHERE id = '00000000-0000-0000-0000-00000000a501'),
  'aaaaaaaa-aaaa-ac03-0000-000000000000'::uuid,
  'artist_id-stamped invite links the exact artist by id');

-- 9. User E already owns a502; accepting an id-stamped invite for a504 must not error.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac05-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.accept_invitation('tok-accept-eee') ->> 'artist_linked'),
  'false',
  'guard no-op when caller already owns an artist -> artist_linked false');
RESET ROLE;
-- 10. The guard no-ops: a504 stays unclaimed (no partial-unique-index violation).
SELECT is(
  (SELECT user_id FROM public.artists WHERE id = '00000000-0000-0000-0000-00000000a504'),
  null::uuid,
  'claim no-ops when the caller already owns an artist in the org');

-- 11. Legacy invitee D (no artist_id) accepts.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac04-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.accept_invitation('tok-accept-ddd') ->> 'org_id'),
  '00000000-0000-0000-0000-0000000ac002',
  'legacy accept returns org_id in the jsonb result');
RESET ROLE;
-- 12. Legacy email path still links by lowercased email.
SELECT is(
  (SELECT user_id FROM public.artists WHERE id = '00000000-0000-0000-0000-00000000a503'),
  'aaaaaaaa-aaaa-ac04-0000-000000000000'::uuid,
  'legacy email path still links by lowercased email');

-- 13-14. Accept routes through ensure_invitation_membership: a plain-email artist invite
--        with NO matching artists row must auto-create the artist profile. The count
--        assertion goes red on the OLD accept (which never auto-created), green after wiring.
SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000ac0f1','Accept AutoCreate Org','accept-autocreate-org');
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-ac06-0000-000000000000','authenticated','authenticated','accept-f@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.org_invitations (org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-0000000ac0f1','accept-f@test.com','artist','tok-accept-fff','pending');
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac06-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.accept_invitation('tok-accept-fff') $$,'plain artist invite accepts');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id='00000000-0000-0000-0000-0000000ac0f1' AND user_id='aaaaaaaa-aaaa-ac06-0000-000000000000'),
  1, 'accept auto-creates the artist profile for a plain-email artist invite');

SELECT * FROM finish();
ROLLBACK;
