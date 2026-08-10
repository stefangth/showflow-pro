-- Tests for public.mark_invitation_resent(p_id): stamps last_resent_at + bumps resent_count,
-- and is service-role only (the resend edge function authorizes the caller first).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('ffffffff-ffff-f001-0000-000000000000','authenticated','authenticated','mr-a@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('00000000-0000-0000-0000-0000000f0001','MR Org','mr-org');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000f101','00000000-0000-0000-0000-0000000f0001','mr-invitee@test.com','artist','tok-mr','pending');
SET session_replication_role = DEFAULT;

-- 1-2. Fresh invite: count 0, last_resent_at null.
SELECT is((SELECT resent_count FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000f101'), 0, 'resent_count defaults to 0');
SELECT ok((SELECT last_resent_at IS NULL FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000f101'), 'last_resent_at starts null');
-- 3-4. First stamp bumps count to 1 and sets last_resent_at.
SELECT public.mark_invitation_resent('00000000-0000-0000-0000-00000000f101');
SELECT is((SELECT resent_count FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000f101'), 1, 'first resend bumps count to 1');
SELECT ok((SELECT last_resent_at IS NOT NULL FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000f101'), 'last_resent_at is stamped');
-- 5. Second stamp increments again (idempotency is NOT the point — every resend counts).
SELECT public.mark_invitation_resent('00000000-0000-0000-0000-00000000f101');
SELECT is((SELECT resent_count FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000f101'), 2, 'second resend bumps count to 2');
-- 6. Grant boundary: NOT executable by authenticated (service-role only).
SELECT set_config('request.jwt.claims','{"sub":"ffffffff-ffff-f001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.mark_invitation_resent('00000000-0000-0000-0000-00000000f101') $$,
  '42501', NULL, 'authenticated cannot execute mark_invitation_resent');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
