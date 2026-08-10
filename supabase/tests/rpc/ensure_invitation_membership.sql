-- Tests for public.ensure_invitation_membership(p_invitation, p_user).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('bbbbbbbb-bbbb-e001-0000-000000000000','authenticated','authenticated','ensure-a@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-bbbb-e002-0000-000000000000','authenticated','authenticated','ensure-b@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-bbbb-e003-0000-000000000000','authenticated','authenticated','ensure-c@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-bbbb-e004-0000-000000000000','authenticated','authenticated','ensure-d@test.com', now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000e0001','Ensure Org','ensure-org');

-- Producer invite (no artist): membership only.
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-0000000e0001','ensure-a@test.com','producer','tok-e-a','pending');
-- Artist invite, plain email, NO matching artist row → must auto-create.
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000e102','00000000-0000-0000-0000-0000000e0001','ensure-b@test.com','artist','tok-e-b','pending');
-- Artist invite, plain email, WITH an unclaimed artist row by email → must claim it.
INSERT INTO public.artists (id, org_id, name, email, status)
VALUES ('00000000-0000-0000-0000-0000000a0501','00000000-0000-0000-0000-0000000e0001','Claimable','ensure-c@test.com','active');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000e103','00000000-0000-0000-0000-0000000e0001','ensure-c@test.com','artist','tok-e-c','pending');
-- Artist invite stamped with an explicit artist_id → deterministic claim-by-id; the same
-- function runs again over the invite's lifecycle (invite-time, then accept / self-heal).
INSERT INTO public.artists (id, org_id, name, email, status)
VALUES ('00000000-0000-0000-0000-0000000a0502','00000000-0000-0000-0000-0000000e0001','ClaimById','ensure-d@test.com','active');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status, artist_id)
VALUES ('00000000-0000-0000-0000-00000000e104','00000000-0000-0000-0000-0000000e0001','ensure-d@test.com','artist','tok-e-d','pending','00000000-0000-0000-0000-0000000a0502');
SET session_replication_role = DEFAULT;

-- 1. Producer invite → membership created (returns true, nothing to link).
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e101','bbbbbbbb-bbbb-e001-0000-000000000000'),
  true, 'producer invite returns artist_linked true');
-- 2. Membership row exists for the producer.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e001-0000-000000000000' AND role='producer'),
  1, 'producer membership created');
-- 3. No artist row was created for a producer.
SELECT is(
  (SELECT count(*)::int FROM public.artists WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e001-0000-000000000000'),
  0, 'producer gets no artist row');
-- 4. Artist invite with no matching row → auto-creates an artist.
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e102','bbbbbbbb-bbbb-e002-0000-000000000000'),
  true, 'artist invite with no row returns true');
-- 5. The auto-created artist has the user linked and name from the email local-part.
SELECT is(
  (SELECT name FROM public.artists WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e002-0000-000000000000'),
  'ensure-b', 'auto-created artist name derives from email local-part');
-- 6. Artist membership row exists.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e002-0000-000000000000' AND role='artist'),
  1, 'artist membership created');
-- 7. Artist invite with an unclaimed email row → claims it (no new row).
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e103','bbbbbbbb-bbbb-e003-0000-000000000000'),
  true, 'artist invite claims an unclaimed email row');
-- 8. That exact row is now owned; no duplicate artist was created.
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e003-0000-000000000000'),
  1, 'email claim links exactly one artist row, no duplicate');
-- 9a. artist_id invite: first call claims the catalog artist by id and reports linked.
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e104','bbbbbbbb-bbbb-e004-0000-000000000000'),
  true, 'artist_id invite claims by id and returns linked');
-- 9b. Regression: a REPEAT call (already linked to this user from the first call) still
--     reports artist_linked=true, not false, so accept/self-heal never mislabels a genuinely
--     linked artist as "couldn't link".
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e104','bbbbbbbb-bbbb-e004-0000-000000000000'),
  true, 'repeat call on an already-linked artist_id invite still returns linked');
-- 10. Grant boundary: NOT executable by authenticated (service_role only). The permission
--    check fires before execution, so a repeat invitation id still throws 42501. This
--    assertion is load-bearing for the owner-privilege model in Global Constraints:
--    keep the grant service-role-only; do NOT add `authenticated` here.
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-e001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e101','bbbbbbbb-bbbb-e001-0000-000000000000') $$,
  '42501', NULL, 'authenticated cannot execute ensure_invitation_membership');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
