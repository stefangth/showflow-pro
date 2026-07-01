-- bulk_import_artists(p_org, p_rows): producer/admin-guarded SECURITY DEFINER bulk
-- insert with server-side dedup on lower(email); returns per-row jsonb status.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-cc01-0000-000000000000','authenticated','authenticated','prod@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-cc02-0000-000000000000','authenticated','authenticated','art@x.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000cc0a1','Import Org A','import-org-a'),
  ('00000000-0000-0000-0000-0000000cc0b1','Import Org B','import-org-b');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000cc0a1','aaaaaaaa-aaaa-cc01-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-0000000cc0a1','aaaaaaaa-aaaa-cc02-0000-000000000000','artist');
-- Existing artist for the dedup case (org A).
INSERT INTO public.artists (id, org_id, name, email, status) VALUES
  ('00000000-0000-0000-0000-0000000cc0d1','00000000-0000-0000-0000-0000000cc0a1','Ada Existing','ada@x.com','active');
SET session_replication_role = DEFAULT;

-- Producer of org A.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-cc01-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- 1. Producer imports a new row → 'created' (this call inserts the row).
SELECT is(
  (public.bulk_import_artists('00000000-0000-0000-0000-0000000cc0a1',
     '[{"index":0,"name":"New Art","email":"new@x.com","phone":null,"bio":null}]'::jsonb) -> 0 ->> 'status'),
  'created', 'producer import of a new row returns created');

-- 2. The created artist exists with status active and the right org.
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id = '00000000-0000-0000-0000-0000000cc0a1' AND lower(email) = 'new@x.com' AND status = 'active'),
  1, 'the new artist row was inserted (active, org-scoped)');

-- 5. Dedup: an existing email (case-insensitive) is skipped.
SELECT is(
  (public.bulk_import_artists('00000000-0000-0000-0000-0000000cc0a1',
     '[{"index":0,"name":"Dupe","email":"Ada@X.com","phone":null,"bio":null}]'::jsonb) -> 0 ->> 'status'),
  'skipped_existing', 'a row whose email already exists is skipped');

-- 6. Dedup did not insert a second row.
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id = '00000000-0000-0000-0000-0000000cc0a1' AND lower(email) = 'ada@x.com'),
  1, 'dedup does not create a duplicate');
RESET ROLE;

-- 3. Artist-role caller is rejected.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-cc02-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.bulk_import_artists('00000000-0000-0000-0000-0000000cc0a1', '[]'::jsonb) $$,
  '42501', null, 'artist-role caller is rejected');
RESET ROLE;

-- 4. Cross-org: producer of A calling with org B is rejected.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-cc01-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.bulk_import_artists('00000000-0000-0000-0000-0000000cc0b1', '[]'::jsonb) $$,
  '42501', null, 'producer of another org is rejected (cross-org)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
