-- org_member_removals + remove_org_member (tombstone) + list_removed_members +
-- restore_org_member (undo) + clear_removed_member (dismiss) +
-- admin_anonymize_removed_user (last-org-guarded full erase).
-- Source: 20260811103008_org_member_removals.sql.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(13);

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','admin@t.test',now(),'{"provider":"email"}','{}',now(),now()),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','artist@t.test',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A','org-a-removal'),
  ('aaaaaaaa-0000-0000-0000-000000000002','Org B','org-b-removal');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','admin'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','artist');
INSERT INTO public.profiles (user_id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111','Ada Admin'),
  ('22222222-2222-2222-2222-222222222222','Artie Artist');
SET session_replication_role = DEFAULT;

-- Act as the admin.
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

-- 1. Removing the artist deletes the membership.
SELECT lives_ok(
  $$ SELECT public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'admin removes the artist');
SELECT is_empty(
  $$ SELECT 1 FROM public.org_memberships WHERE org_id='aaaaaaaa-0000-0000-0000-000000000001' AND user_id='22222222-2222-2222-2222-222222222222' $$,
  'membership row is gone');

-- 2. A tombstone was written with the role snapshot.
SELECT results_eq(
  $$ SELECT roles FROM public.org_member_removals WHERE org_id='aaaaaaaa-0000-0000-0000-000000000001' AND user_id='22222222-2222-2222-2222-222222222222' $$,
  $$ VALUES (ARRAY['artist']::app_role[]) $$,
  'tombstone snapshots the removed roles');

-- 3. list_removed_members shows the tombstone, deletable=true (artist had no other org).
SELECT results_eq(
  $$ SELECT user_id, deletable FROM public.list_removed_members('aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ VALUES ('22222222-2222-2222-2222-222222222222'::uuid, true) $$,
  'list_removed_members returns the tombstone as deletable');

-- 4. Self-removal is blocked (self-guard fires before the last-admin guard).
SELECT throws_ok(
  $$ SELECT public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111') $$,
  '42501', 'You cannot remove your own membership',
  'self-removal still blocked');

-- 5. A non-admin cannot call remove_org_member.
RESET ROLE;
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111') $$,
  '42501', 'Forbidden: org admin only',
  'non-admin blocked from remove_org_member');

-- Back to the admin.
RESET ROLE;
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

-- 6. Undo re-inserts the membership with its original role and drops the tombstone.
SELECT lives_ok(
  $$ SELECT public.restore_org_member('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'admin restores the removed artist');
SELECT results_eq(
  $$ SELECT role FROM public.org_memberships WHERE org_id='aaaaaaaa-0000-0000-0000-000000000001' AND user_id='22222222-2222-2222-2222-222222222222' $$,
  $$ VALUES ('artist'::app_role) $$,
  'membership restored with original role');
SELECT is_empty(
  $$ SELECT 1 FROM public.org_member_removals WHERE org_id='aaaaaaaa-0000-0000-0000-000000000001' AND user_id='22222222-2222-2222-2222-222222222222' $$,
  'tombstone cleared after restore');

-- Re-remove the artist so a tombstone exists again for the anonymize tests.
SELECT public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

-- 7. admin_anonymize refuses when the target still belongs to another org.
RESET ROLE;
SET session_replication_role = replica;
INSERT INTO public.org_memberships (org_id, user_id, role)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','artist');
SET session_replication_role = DEFAULT;
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_anonymize_removed_user('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'P0001', 'User still belongs to another organization',
  'admin anonymize refuses when target is in another org');

-- 8. With no other membership + an artist profile, admin anonymize succeeds and anonymizes it.
RESET ROLE;
SET session_replication_role = replica;
DELETE FROM public.org_memberships WHERE org_id='aaaaaaaa-0000-0000-0000-000000000002' AND user_id='22222222-2222-2222-2222-222222222222';
INSERT INTO public.artists (id, org_id, name, email, user_id)
  VALUES ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Art Ist','artist@t.test','22222222-2222-2222-2222-222222222222');
SET session_replication_role = DEFAULT;
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.admin_anonymize_removed_user('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'admin anonymize succeeds for a last-org removed user');
SELECT results_eq(
  $$ SELECT name, user_id FROM public.artists WHERE id='cccccccc-0000-0000-0000-000000000001' $$,
  $$ VALUES ('Deleted artist'::text, NULL::uuid) $$,
  'artist profile anonymized + unlinked');

-- 9. anon has no execute privilege on the new RPCs.
RESET ROLE;
SELECT is(
  has_function_privilege('anon','public.list_removed_members(uuid)','execute'),
  false, 'anon cannot execute list_removed_members');

SELECT * FROM finish();
ROLLBACK;
