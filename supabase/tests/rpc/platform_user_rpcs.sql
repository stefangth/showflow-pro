-- Tests for the platform_* super-admin RPCs (membership + artist link).
--   aaaa…0001 super-admin        aaaa…0002 org admin        aaaa…0003 regular user
--   bbbb…0001 org                cccc…0001 artist           dddd…0001 show_date
-- The artist-link section doubles as the regression for the reported hire-order bug:
-- re-pointing artists.user_id makes the org's issued order visible to the new account.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('aaaa0000-0000-0000-0000-000000000001','authenticated','authenticated','sa@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000002','authenticated','authenticated','admin@test.com',now(),now()),
  ('aaaa0000-0000-0000-0000-000000000003','authenticated','authenticated','reg@test.com',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaa0000-0000-0000-0000-000000000001');
INSERT INTO public.organizations (id, name, slug) VALUES ('bbbb0000-0000-0000-0000-000000000001','Org','pm-org');
INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','admin');
SET session_replication_role = DEFAULT;

-- 1. non-super-admin is rejected
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer','add') $$,
  '42501', null, 'non-super-admin cannot set membership');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- 2. super-admin adds a producer role
SELECT lives_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','producer','add') $$,
  'super-admin adds a role');
-- 3. role present
SELECT isnt_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE user_id='aaaa0000-0000-0000-0000-000000000003' AND role='producer' $$,
  'producer role present');
-- 4. removing the only admin is blocked
SELECT throws_ok(
  $$ SELECT public.platform_set_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000002','admin','remove') $$,
  'P0001', null, 'cannot remove the last admin');
-- 5. remove_membership on non-admin succeeds
SELECT lives_ok(
  $$ SELECT public.platform_remove_membership('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003') $$,
  'super-admin removes a non-admin member');
-- 6. member removed
SELECT is_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE user_id='aaaa0000-0000-0000-0000-000000000003' AND org_id='bbbb0000-0000-0000-0000-000000000001' $$,
  'member removed from org');
RESET ROLE;

-- Artist-link + hire-order regression seed. reg user (…003) is re-added as an org member
-- (artist role) because hire_orders has a RESTRICTIVE org_isolation policy: visibility
-- requires BOTH org membership AND the artist link.
SET session_replication_role = replica;
INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','artist');
INSERT INTO public.artists (id, org_id, name, email, status)
  VALUES ('cccc0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','Artist','a@test.com','active');
INSERT INTO public.show_dates (id, org_id, show_id, date)
  VALUES ('dddd0000-0000-0000-0000-000000000001','bbbb0000-0000-0000-0000-000000000001','eeee0000-0000-0000-0000-000000000001','2026-08-01');
INSERT INTO public.hire_orders (org_id, artist_id, show_date_id, order_no, data, status)
  VALUES ('bbbb0000-0000-0000-0000-000000000001','cccc0000-0000-0000-0000-000000000001','dddd0000-0000-0000-0000-000000000001','HO-TEST-1','{}'::jsonb,'issued');
SET session_replication_role = DEFAULT;

-- 7. super-admin links the artist to the regular user
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.platform_link_artist('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003','cccc0000-0000-0000-0000-000000000001') $$,
  'super-admin links artist to a user');
RESET ROLE;

-- 8. REGRESSION: the newly-linked user now sees the issued order under hire_orders RLS
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT isnt_empty(
  $$ SELECT 1 FROM public.hire_orders WHERE order_no = 'HO-TEST-1' $$,
  'linked user now sees the issued hire order (bug fix)');
RESET ROLE;

-- 9. unlink clears user_id
SELECT set_config('request.jwt.claims','{"sub":"aaaa0000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.platform_link_artist('bbbb0000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000003', null) $$,
  'super-admin unlinks the artist');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
