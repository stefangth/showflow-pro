-- Invitation lifetime, auth-exchange, and authenticated self password-status contracts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(24);

SET session_replication_role = replica;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('ffffffff-ffff-f101-0000-000000000001', 'authenticated', 'authenticated',
   'passwordless@test.com', NULL, now(), '{"provider":"email"}', '{}', now(), now()),
  ('ffffffff-ffff-f101-0000-000000000002', 'authenticated', 'authenticated',
   'password@test.com', '$2a$10$not-a-real-hash-but-nonempty', now(),
   '{"provider":"email"}', '{}', now(), now());

INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000f0101', 'Invitation Auth Org', 'invitation-auth-org');

INSERT INTO public.org_invitations (
  id, org_id, email, role, token, status, expires_at
) VALUES
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-0000000f0101', 'renew@test.com', 'artist', 'renew-token', 'pending', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-0000000f0101', 'claim-role@test.com', 'artist', 'claim-role-token', 'pending', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-0000000f0101', 'valid@test.com', 'artist', 'valid-token', 'pending', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000f104', '00000000-0000-0000-0000-0000000f0101', 'accepted@test.com', 'artist', 'accepted-token', 'accepted', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000f105', '00000000-0000-0000-0000-0000000f0101', 'revoked@test.com', 'artist', 'revoked-token', 'revoked', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000f106', '00000000-0000-0000-0000-0000000f0101', 'expired@test.com', 'artist', 'expired-token', 'pending', now() - interval '1 second'),
  ('00000000-0000-0000-0000-00000000f107', '00000000-0000-0000-0000-0000000f0101', 'rounded@test.com', 'artist', 'rounded-token', 'pending', now() + interval '1 day');

SET session_replication_role = DEFAULT;

SELECT is(
  (SELECT column_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'org_invitations' AND column_name = 'expires_at'),
  '(now() + ''30 days''::interval)',
  'new invitations default to 30 days'
);

SELECT ok(
  (SELECT is_nullable = 'YES' FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'org_invitations' AND column_name = 'last_auth_exchange_at'),
  'the auth exchange timestamp exists and is nullable'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.renew_invitation_for_resend('00000000-0000-0000-0000-00000000f101') $$,
  '42501', NULL, 'authenticated cannot renew an invitation for resend'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT public.claim_invitation_auth_exchange('claim-role-token', 60) $$,
  '42501', NULL, 'anonymous callers cannot claim an auth exchange'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.renew_invitation_for_resend('00000000-0000-0000-0000-00000000f101') $$,
  'service role can renew an invitation for resend'
);
SELECT lives_ok(
  $$ SELECT public.claim_invitation_auth_exchange('claim-role-token', 60) $$,
  'service role can claim an auth exchange'
);
RESET ROLE;

SELECT is(
  public.renew_invitation_for_resend('00000000-0000-0000-0000-00000000f101'),
  now() + interval '30 days',
  'resend restarts the full lifetime'
);

SELECT ok(
  (SELECT last_auth_exchange_at IS NULL FROM public.org_invitations
   WHERE id = '00000000-0000-0000-0000-00000000f101'),
  'resend clears the previous auth exchange timestamp'
);

SELECT is(public.claim_invitation_auth_exchange('missing-token', 60),
          '{"status":"unavailable"}'::jsonb,
          'a missing token is unavailable');
SELECT is(public.claim_invitation_auth_exchange('accepted-token', 60),
          '{"status":"unavailable"}'::jsonb,
          'an accepted token is unavailable');
SELECT is(public.claim_invitation_auth_exchange('revoked-token', 60),
          '{"status":"unavailable"}'::jsonb,
          'a revoked token is unavailable');
SELECT is(public.claim_invitation_auth_exchange('expired-token', 60),
          '{"status":"unavailable"}'::jsonb,
          'an expired token is unavailable');

SELECT is(
  public.claim_invitation_auth_exchange('valid-token', 60)->>'status',
  'ok',
  'a pending unexpired token is claimable'
);
UPDATE public.org_invitations
SET last_auth_exchange_at = NULL
WHERE token = 'valid-token';
SELECT is(
  public.claim_invitation_auth_exchange('valid-token', 60),
  '{"status":"ok","email":"valid@test.com"}'::jsonb,
  'the successful exchange contract contains only status and email'
);
SELECT is(
  public.claim_invitation_auth_exchange('valid-token', 60)->>'status',
  'throttled',
  'the atomic second claim is throttled'
);
SELECT is(
  (public.claim_invitation_auth_exchange('valid-token', 60) - 'retry_after_seconds'),
  '{"status":"throttled"}'::jsonb,
  'the throttled exchange contract contains only status and retry seconds'
);
SELECT ok(
  (public.claim_invitation_auth_exchange('valid-token', 60)->>'retry_after_seconds')::integer > 0,
  'a throttled exchange reports positive retry seconds'
);

UPDATE public.org_invitations
SET last_auth_exchange_at = now() - interval '59.2 seconds'
WHERE token = 'rounded-token';
SELECT is(
  (public.claim_invitation_auth_exchange('rounded-token', 60)->>'retry_after_seconds')::integer,
  1,
  'retry seconds are positive and rounded up'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ffffffff-ffff-f101-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.my_has_password() $$,
                'authenticated users can query their own password status');
SELECT is(public.my_has_password(), false,
          'a passwordless self result is false');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"ffffffff-ffff-f101-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(public.my_has_password(), true,
          'a password self result is true');
SELECT throws_ok(
  $$ SELECT public.my_has_password('ffffffff-ffff-f101-0000-000000000001'::uuid) $$,
  '42883', NULL, 'password status has no cross-user input surface'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.my_has_password() $$,
                 '42501', NULL, 'anonymous callers cannot query password status');
RESET ROLE;

SELECT ok(
  (SELECT last_auth_exchange_at IS NOT NULL FROM public.org_invitations
   WHERE token = 'valid-token'),
  'a successful claim atomically stamps the invitation'
);

SELECT * FROM finish();
ROLLBACK;
