-- At most one PENDING invitation per (org, lower(email)) is a DB guarantee
-- (partial unique index org_invitations_pending_email_uniq). Accepted/revoked
-- invites are excluded, so a revoked address stays re-invitable.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-invite-uniq');
INSERT INTO public.organizations (id, name, slug)
  VALUES ('22222222-2222-2222-2222-222222222222', 'Org B', 'org-b-invite-uniq');

INSERT INTO public.org_invitations (org_id, email, role)
  VALUES ('11111111-1111-1111-1111-111111111111', 'dup@x.com', 'artist');

-- 1) a second PENDING invite for the same (org, email) is rejected
SELECT throws_ok(
  $$ INSERT INTO public.org_invitations (org_id, email, role)
     VALUES ('11111111-1111-1111-1111-111111111111', 'dup@x.com', 'producer') $$,
  '23505', NULL,
  'second pending invite for same (org, email) is rejected');

-- 2) uniqueness is case-insensitive (index is on lower(email))
SELECT throws_ok(
  $$ INSERT INTO public.org_invitations (org_id, email, role)
     VALUES ('11111111-1111-1111-1111-111111111111', 'DUP@X.COM', 'artist') $$,
  '23505', NULL,
  'case-variant duplicate pending invite is rejected');

-- 3) a REVOKED duplicate is allowed (partial index excludes non-pending)
SELECT lives_ok(
  $$ INSERT INTO public.org_invitations (org_id, email, role, status)
     VALUES ('11111111-1111-1111-1111-111111111111', 'dup@x.com', 'artist', 'revoked') $$,
  'revoked duplicate is allowed');

-- 4) after the pending one is revoked, a fresh pending invite is allowed (re-invite)
UPDATE public.org_invitations
  SET status = 'revoked'
  WHERE org_id = '11111111-1111-1111-1111-111111111111'
    AND lower(email) = 'dup@x.com'
    AND status = 'pending';
SELECT lives_ok(
  $$ INSERT INTO public.org_invitations (org_id, email, role)
     VALUES ('11111111-1111-1111-1111-111111111111', 'dup@x.com', 'artist') $$,
  're-invite after revoke is allowed');

-- 5) a different email in the same org is allowed (index does not over-constrain)
SELECT lives_ok(
  $$ INSERT INTO public.org_invitations (org_id, email, role)
     VALUES ('11111111-1111-1111-1111-111111111111', 'other@x.com', 'artist') $$,
  'different email in same org is allowed');

-- 6) the same email in a DIFFERENT org is allowed (index is org-scoped)
SELECT lives_ok(
  $$ INSERT INTO public.org_invitations (org_id, email, role)
     VALUES ('22222222-2222-2222-2222-222222222222', 'dup@x.com', 'artist') $$,
  'same email in a different org is allowed');

SELECT * FROM finish();
ROLLBACK;
