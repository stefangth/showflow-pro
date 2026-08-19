-- pgTAP: the new "org members read suppressed_emails for their artists" policy
-- (20260819090000_suppressed_emails_org_member_read.sql).
--
-- suppressed_emails has no org_id column -- it is a global, email-keyed bounce
-- list -- so this policy scopes it indirectly through the artist roster: a
-- member may read a suppression row only when that email belongs to an artist
-- in an org they belong to. The negative case (assertion 2) is the important
-- one: it proves the policy does NOT leak an arbitrary suppressed email to a
-- member whose org has no artist with that address.
--
--   11111111-…-0001 org1 admin (has an artist with the suppressed email)
--   11111111-…-0002 org2 admin (different org, no matching artist)
--   22222222-…-0001 org1   22222222-…-0002 org2
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('11111111-0006-4001-8001-000000000001','authenticated','authenticated','se-org1-admin@t.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('11111111-0006-4001-8001-000000000002','authenticated','authenticated','se-org2-admin@t.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-0006-4001-8001-000000000001','Suppressed Emails Org1','se-org1'),
  ('22222222-0006-4001-8001-000000000002','Suppressed Emails Org2','se-org2');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0006-4001-8001-000000000001','11111111-0006-4001-8001-000000000001','admin'),
  ('22222222-0006-4001-8001-000000000002','11111111-0006-4001-8001-000000000002','admin');

-- org1's artist has this booking email; org2 has no artist with it at all.
INSERT INTO public.artists (id, name, org_id, email) VALUES
  ('66666666-0006-4001-8001-000000000001','Bounced Artist','22222222-0006-4001-8001-000000000001',
     'bounced-artist@example.com');

-- Stored with different case than the artist row, to prove the policy's
-- lower()/lower() comparison (matching house style) is actually exercised.
INSERT INTO public.suppressed_emails (email, reason) VALUES
  ('Bounced-Artist@Example.com','bounce');
SET session_replication_role = DEFAULT;

-- 1. org1 admin CAN read the suppression row for their own artist's email,
--    even though the stored casing differs.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT reason FROM public.suppressed_emails WHERE email = 'Bounced-Artist@Example.com'),
  'bounce', 'org1 admin can read the suppression row for their own artist''s email');
RESET ROLE;

-- 2. org2 admin (no artist with this email in their org) CANNOT read it.
--    This is the important negative case: it fails loudly if the policy is
--    ever broadened past the artist-roster scope.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ select 1 from public.suppressed_emails where email = 'Bounced-Artist@Example.com' $$,
  'org2 admin cannot read a suppression row for an email with no matching artist in their org');
RESET ROLE;

-- 3. Give org2 its own artist with a DIFFERENT suppressed email, and confirm
--    org2 can read that one -- proving the policy is genuinely artist-scoped,
--    not merely "any org member reads nothing".
SET session_replication_role = replica;
INSERT INTO public.artists (id, name, org_id, email) VALUES
  ('66666666-0006-4001-8001-000000000002','Other Bounced Artist','22222222-0006-4001-8001-000000000002',
     'other-bounced@example.com');
INSERT INTO public.suppressed_emails (email, reason) VALUES
  ('other-bounced@example.com','complaint');
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT reason FROM public.suppressed_emails WHERE email = 'other-bounced@example.com'),
  'complaint', 'org2 admin can read the suppression row for their own artist''s email');
RESET ROLE;

-- 4. org1 admin still cannot read org2's suppression row (isolation holds in
--    both directions).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0006-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ select 1 from public.suppressed_emails where email = 'other-bounced@example.com' $$,
  'org1 admin cannot read org2''s suppression row');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
