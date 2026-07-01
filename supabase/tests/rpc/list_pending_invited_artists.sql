-- list_pending_invited_artists(p_org): member-guarded; returns distinct artist ids
-- with a LIVE pending invite (id-stamped OR legacy email-matched); excludes
-- expired/accepted/revoked; rejects non-members; anon cannot execute.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-bb01-0000-000000000000','authenticated','authenticated','member@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-bb02-0000-000000000000','authenticated','authenticated','outsider@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000bbc01','Pending Org','pending-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000bbc01','aaaaaaaa-aaaa-bb01-0000-000000000000','producer');

-- a1: id-stamped live invite. a2: legacy email-matched live invite.
-- a3: expired invite (excluded). a4: accepted invite (excluded). a5: no invite.
INSERT INTO public.artists (id, org_id, name, email, status) VALUES
  ('00000000-0000-0000-0000-0000000bba01','00000000-0000-0000-0000-0000000bbc01','A1','a1-booking@x.com','active'),
  ('00000000-0000-0000-0000-0000000bba02','00000000-0000-0000-0000-0000000bbc01','A2','a2@x.com','active'),
  ('00000000-0000-0000-0000-0000000bba03','00000000-0000-0000-0000-0000000bbc01','A3','a3@x.com','active'),
  ('00000000-0000-0000-0000-0000000bba04','00000000-0000-0000-0000-0000000bbc01','A4','a4@x.com','active'),
  ('00000000-0000-0000-0000-0000000bba05','00000000-0000-0000-0000-0000000bbc01','A5','a5@x.com','active');

INSERT INTO public.org_invitations (org_id, email, role, token, status, expires_at, artist_id) VALUES
  ('00000000-0000-0000-0000-0000000bbc01','a1-login@x.com','artist','tok-pa1','pending', now() + interval '7 days','00000000-0000-0000-0000-0000000bba01'),
  ('00000000-0000-0000-0000-0000000bbc01','a2@x.com',      'artist','tok-pa2','pending', now() + interval '7 days', null),
  ('00000000-0000-0000-0000-0000000bbc01','a3@x.com',      'artist','tok-pa3','pending', now() - interval '1 day',  null),
  ('00000000-0000-0000-0000-0000000bbc01','a4@x.com',      'artist','tok-pa4','accepted',now() + interval '7 days', null);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-bb01-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- 1. Returns the id-stamped artist.
SELECT ok(
  '00000000-0000-0000-0000-0000000bba01' IN (SELECT public.list_pending_invited_artists('00000000-0000-0000-0000-0000000bbc01')),
  'includes the id-stamped artist');
-- 2. Returns the legacy email-matched artist.
SELECT ok(
  '00000000-0000-0000-0000-0000000bba02' IN (SELECT public.list_pending_invited_artists('00000000-0000-0000-0000-0000000bbc01')),
  'includes the legacy email-matched artist');
-- 3. Excludes expired + accepted + no-invite artists (only a1,a2 remain).
SELECT is(
  (SELECT count(*)::int FROM public.list_pending_invited_artists('00000000-0000-0000-0000-0000000bbc01')),
  2, 'excludes expired / accepted / uninvited');
RESET ROLE;

-- 4. Non-member is rejected.
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-bb02-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.list_pending_invited_artists('00000000-0000-0000-0000-0000000bbc01') $$,
  '42501', null, 'non-member is rejected');
RESET ROLE;

-- 5. anon has no execute privilege.
SELECT is(
  has_function_privilege('anon','public.list_pending_invited_artists(uuid)','execute'),
  false, 'anon cannot execute the RPC');

SELECT * FROM finish();
ROLLBACK;
