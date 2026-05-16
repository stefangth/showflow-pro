-- pgTAP coverage for the approval decision RPC used by the
-- admin-decide-approval edge function and signup E2E flow.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-ac00-0001-0000-000000000000', 'authenticated', 'authenticated', 'rpc-approve@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-ac00-0002-0000-000000000000', 'authenticated', 'authenticated', 'rpc-reject@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.user_roles (user_id, role)
VALUES ('aaaaaaaa-ac00-0002-0000-000000000000', 'artist'::app_role);

INSERT INTO public.user_approvals (id, user_id, email, status, requested_role)
VALUES
  ('bbbbbbbb-ac00-0001-0000-000000000000', 'aaaaaaaa-ac00-0001-0000-000000000000', 'rpc-approve@test.com', 'pending'::approval_status, 'artist'::app_role),
  ('bbbbbbbb-ac00-0002-0000-000000000000', 'aaaaaaaa-ac00-0002-0000-000000000000', 'rpc-reject@test.com',  'pending'::approval_status, 'artist'::app_role);

SET session_replication_role = DEFAULT;

SELECT lives_ok(
  $$ SELECT public.decide_user_approval('bbbbbbbb-ac00-0001-0000-000000000000', 'approved', 'producer', NULL, 'aaaaaaaa-ac00-0001-0000-000000000000') $$,
  'approving a user via decide_user_approval succeeds'
);

SELECT is(
  (SELECT status::text FROM public.user_approvals WHERE id = 'bbbbbbbb-ac00-0001-0000-000000000000'),
  'approved',
  'approval row is marked approved'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_roles WHERE user_id = 'aaaaaaaa-ac00-0001-0000-000000000000' AND role = 'producer'::app_role),
  1,
  'approved role is granted'
);

SELECT lives_ok(
  $$ SELECT public.decide_user_approval('bbbbbbbb-ac00-0002-0000-000000000000', 'rejected', 'artist', 'not this time', 'aaaaaaaa-ac00-0001-0000-000000000000') $$,
  'rejecting a user via decide_user_approval succeeds'
);

SELECT is(
  (SELECT status::text || '|' || COALESCE(rejection_reason, '') || '|' || (SELECT count(*)::text FROM public.user_roles WHERE user_id = 'aaaaaaaa-ac00-0002-0000-000000000000')
   FROM public.user_approvals
   WHERE id = 'bbbbbbbb-ac00-0002-0000-000000000000'),
  'rejected|not this time|0',
  'rejection stores reason and clears roles'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.decide_user_approval(uuid,text,text,text,uuid)',
    'EXECUTE'
  ),
  false,
  'authenticated callers cannot execute the service-role-only approval RPC directly'
);

SELECT * FROM finish();

ROLLBACK;
