-- Tests for public.claim_my_invitations(): self-heal for any auth path.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('cccccccc-cccc-c101-0000-000000000000','authenticated','authenticated','claim-a@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000c1001','Claim Org','claim-org');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status, expires_at)
VALUES ('00000000-0000-0000-0000-00000000c111','00000000-0000-0000-0000-0000000c1001','claim-a@test.com','artist','tok-claim-a','pending', now() + interval '7 days');
SET session_replication_role = DEFAULT;

-- 1. Claiming returns the count of pending invitations reconciled.
SELECT set_config('request.jwt.claims','{"sub":"cccccccc-cccc-c101-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.claim_my_invitations(), 1, 'claims the one pending invitation');
RESET ROLE;
-- 2. Membership was created.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000c1001' AND user_id='cccccccc-cccc-c101-0000-000000000000' AND role='artist'),
  1, 'membership created by claim');
-- 3. Artist profile auto-created.
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id='00000000-0000-0000-0000-0000000c1001' AND user_id='cccccccc-cccc-c101-0000-000000000000'),
  1, 'artist profile auto-created by claim');
-- 4. Invitation is now accepted.
SELECT is(
  (SELECT status FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000c111'),
  'accepted', 'invitation marked accepted');

SELECT * FROM finish();
ROLLBACK;
