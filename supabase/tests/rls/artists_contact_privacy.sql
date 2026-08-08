-- pgTAP: artist contact-field (email/phone) read privacy.
--
-- Regression backstop for the "dead column-grant" bug: the April 2026 column-level
-- REVOKE (email, phone) was nullified by a later blanket table GRANT, and nothing
-- ever proved that a non-privileged member still cannot read another artist's
-- contact fields. Row visibility is governed purely by RLS SELECT policies:
--   * admin/producer  -> all org artists (contact included)
--   * super-admin     -> all artists, cross-org (god mode)
--   * self            -> own record only
-- A plain 'artist' member therefore reads ZERO other-artist rows. If a future
-- migration re-adds a broad USING(true) read policy, the is_empty (negative)
-- assertions below go red here.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

-- Seed (bypass triggers/FKs while inserting fixtures).
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0005-4001-8001-000000000001','authenticated','authenticated','ac-admin@t.com',now(),now()),
  ('11111111-0005-4001-8001-000000000002','authenticated','authenticated','ac-prod@t.com',now(),now()),
  ('11111111-0005-4001-8001-000000000003','authenticated','authenticated','ac-artistA@t.com',now(),now()),
  ('11111111-0005-4001-8001-000000000004','authenticated','authenticated','ac-other-org@t.com',now(),now()),
  ('11111111-0005-4001-8001-000000000005','authenticated','authenticated','ac-superadmin@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-0005-4001-8001-000000000001','AcOrg1','ac-priv-org1'),
  ('22222222-0005-4001-8001-000000000002','AcOrg2','ac-priv-org2');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0005-4001-8001-000000000001','11111111-0005-4001-8001-000000000001','admin'),
  ('22222222-0005-4001-8001-000000000001','11111111-0005-4001-8001-000000000002','producer'),
  ('22222222-0005-4001-8001-000000000001','11111111-0005-4001-8001-000000000003','artist'),
  ('22222222-0005-4001-8001-000000000002','11111111-0005-4001-8001-000000000004','artist');
-- Super-admin (god mode): a platform_admins row, NOT a member of either org.
INSERT INTO public.platform_admins (user_id) VALUES
  ('11111111-0005-4001-8001-000000000005');
-- artistRowA is artistUserA's own record; artistRowB is a different org1 artist.
INSERT INTO public.artists (id, name, org_id, user_id, email, phone) VALUES
  ('66666666-0005-4001-8001-000000000001','Artist A','22222222-0005-4001-8001-000000000001',
     '11111111-0005-4001-8001-000000000003','a@example.com','+1000000001'),
  ('66666666-0005-4001-8001-000000000002','Artist B','22222222-0005-4001-8001-000000000001',
     NULL,'b@example.com','+1000000002');
SET session_replication_role = DEFAULT;

-- === Plain 'artist' member (artistUserA): the snoop threat ===
SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ select email, phone from public.artists where id='66666666-0005-4001-8001-000000000002' $$,
  'artist member cannot read another artist''s email/phone');
SELECT is_empty(
  $$ select 1 from public.artists where id='66666666-0005-4001-8001-000000000002' $$,
  'artist member cannot even see another artist''s row');
SELECT is(
  (SELECT email FROM public.artists WHERE id='66666666-0005-4001-8001-000000000001'),
  'a@example.com', 'artist member CAN read own email (self policy)');
SELECT is(
  (SELECT phone FROM public.artists WHERE id='66666666-0005-4001-8001-000000000001'),
  '+1000000001', 'artist member CAN read own phone (self policy)');
RESET ROLE;

-- === Admin: contact need preserved ===
SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT email FROM public.artists WHERE id='66666666-0005-4001-8001-000000000002'),
  'b@example.com', 'admin CAN read another artist''s email');
SELECT is(
  (SELECT phone FROM public.artists WHERE id='66666666-0005-4001-8001-000000000002'),
  '+1000000002', 'admin CAN read another artist''s phone');
RESET ROLE;

-- === Producer: contact need preserved ===
SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT email FROM public.artists WHERE id='66666666-0005-4001-8001-000000000002'),
  'b@example.com', 'producer CAN read another artist''s email');
SELECT is(
  (SELECT phone FROM public.artists WHERE id='66666666-0005-4001-8001-000000000002'),
  '+1000000002', 'producer CAN read another artist''s phone');
RESET ROLE;

-- === Super-admin (god mode): reads contact cross-org, without org membership ===
SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT email FROM public.artists WHERE id='66666666-0005-4001-8001-000000000002'),
  'b@example.com', 'super-admin CAN read an artist''s email (god mode)');
SELECT is(
  (SELECT phone FROM public.artists WHERE id='66666666-0005-4001-8001-000000000002'),
  '+1000000002', 'super-admin CAN read an artist''s phone (god mode)');
RESET ROLE;

-- === Cross-org isolation on contact-bearing rows ===
SELECT set_config('request.jwt.claims','{"sub":"11111111-0005-4001-8001-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ select 1 from public.artists where id='66666666-0005-4001-8001-000000000002' $$,
  'member of another org cannot see this org''s artist row');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
