-- pgTAP: producer invitations RLS (Plan 3, Phase 1.7 + follow-up).
-- Producers can SELECT and revoke ARTIST invitations only, revoke gated on
-- producer_can_manage_invitations; cannot see/touch producer invitations; cannot
-- INSERT; admin always. (Producer read of artist invites is NOT capability-gated.)
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0007-4001-8001-000000000001','authenticated','authenticated','oi-admin@t.com',now(),now()),
  ('11111111-0007-4001-8001-000000000002','authenticated','authenticated','oi-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0007-4001-8001-000000000001','OiOrg','oi-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0007-4001-8001-000000000001','11111111-0007-4001-8001-000000000001','admin'),
  ('22222222-0007-4001-8001-000000000001','11111111-0007-4001-8001-000000000002','producer');
INSERT INTO public.org_invitations (id, org_id, email, role, status) VALUES
  ('99999999-0007-4001-8001-000000000001','22222222-0007-4001-8001-000000000001','a1@t.com','artist','pending'),
  ('99999999-0007-4001-8001-000000000002','22222222-0007-4001-8001-000000000001','a2@t.com','artist','pending'),
  ('99999999-0007-4001-8001-000000000003','22222222-0007-4001-8001-000000000001','p1@t.com','producer','pending'),
  ('99999999-0007-4001-8001-000000000004','22222222-0007-4001-8001-000000000001','p2@t.com','producer','pending');
SET session_replication_role = DEFAULT;

-- Producer (manage_invitations on): read scoping + revoke an artist invite + can't INSERT.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0007-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT isnt_empty($$ select 1 from public.org_invitations where role='artist'::app_role $$, 'producer can SELECT artist invitations');
SELECT is_empty($$ select 1 from public.org_invitations where role='producer'::app_role $$, 'producer cannot SELECT producer invitations');
SELECT throws_ok($$ insert into public.org_invitations (org_id, email, role) values ('22222222-0007-4001-8001-000000000001','new@t.com','artist') $$, '42501', NULL, 'producer cannot INSERT org_invitations');
UPDATE public.org_invitations SET status='revoked' WHERE id='99999999-0007-4001-8001-000000000001';
UPDATE public.org_invitations SET status='revoked' WHERE id='99999999-0007-4001-8001-000000000003';
RESET ROLE;

-- Disable manage_invitations, producer revoke attempt no-ops.
SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-0007-4001-8001-000000000001','producer_can_manage_invitations',false);
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims','{"sub":"11111111-0007-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.org_invitations SET status='revoked' WHERE id='99999999-0007-4001-8001-000000000002';
RESET ROLE;

-- Admin revokes a producer invite (always allowed).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0007-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.org_invitations SET status='revoked' WHERE id='99999999-0007-4001-8001-000000000004';
RESET ROLE;

-- Final statuses as owner (bypasses RLS).
SELECT is((SELECT status FROM public.org_invitations WHERE id='99999999-0007-4001-8001-000000000001'), 'revoked', 'producer revoke artist invite allowed when manage on');
SELECT is((SELECT status FROM public.org_invitations WHERE id='99999999-0007-4001-8001-000000000003'), 'pending', 'producer cannot revoke producer invite (scoped to artist)');
SELECT is((SELECT status FROM public.org_invitations WHERE id='99999999-0007-4001-8001-000000000002'), 'pending', 'producer revoke artist invite no-op when manage off');
SELECT is((SELECT status FROM public.org_invitations WHERE id='99999999-0007-4001-8001-000000000004'), 'revoked', 'admin revoke any invite always allowed');

SELECT * FROM finish();
ROLLBACK;
