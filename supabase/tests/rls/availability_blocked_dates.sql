-- RLS tests for public.blocked_dates — the artist-declared conflict/vacation
-- windows table. The critical guard is self-isolation: an artist must never be
-- able to read or modify another artist's blocked dates.
--
-- Policies under test (source migration: 20260514190000):
--   "Artists can manage their own blocked_dates"      — FOR ALL, USING/WITH CHECK
--                                                        artists.user_id = auth.uid()
--   "Admins and producers can view blocked_dates"     — FOR SELECT, has_role admin/producer
--
-- UUID legend (all IDs are test-only, rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist A user
--   aaaaaaaa-aaaa-0004-…  artist B user
--   bbbbbbbb-bbbb-0001-…  artist A profile row
--   bbbbbbbb-bbbb-0002-…  artist B profile row
--   eeeeeeee-eeee-0001-…  blocked_date: artist A (deleted in Test 3)
--   eeeeeeee-eeee-0002-…  blocked_date: artist B
--   eeeeeeee-eeee-0003-…  blocked_date: artist A (survives; used by cross-artist Test 4)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup (as postgres superuser)
-- session_replication_role = replica disables FK trigger checks and auth
-- triggers so we can insert minimal rows without real auth.users constraints.
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-bd-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-bd-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-bd-artista@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'authenticated', 'authenticated', 'rls-bd-artistb@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'admin'::app_role),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'producer'::app_role),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'artist'::app_role),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'artist'::app_role);

-- Phase 1B: org-scoped role-gating — mirror roles as bootstrap-org memberships.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0004-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id) VALUES
  ('bbbbbbbb-bbbb-0001-0000-000000000000', 'BD Artist A', 'aaaaaaaa-aaaa-0003-0000-000000000000'),
  ('bbbbbbbb-bbbb-0002-0000-000000000000', 'BD Artist B', 'aaaaaaaa-aaaa-0004-0000-000000000000');

INSERT INTO public.blocked_dates (id, artist_id, date, reason) VALUES
  ('eeeeeeee-eeee-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', '2099-03-01', 'Artist A vacation'),
  ('eeeeeeee-eeee-0002-0000-000000000000', 'bbbbbbbb-bbbb-0002-0000-000000000000', '2099-03-02', 'Artist B vacation'),
  ('eeeeeeee-eeee-0003-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', '2099-03-03', 'Artist A vacation (survives for cross-artist test)');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- Artist self-management (own rows)
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Artist A sees own blocked_date
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'artist A sees own blocked_date'
);

RESET ROLE;

-- 2. Artist A can INSERT a blocked_date for themselves
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason)
    VALUES ('bbbbbbbb-bbbb-0001-0000-000000000000', '2099-03-10', 'Artist A self-insert')$$,
  'artist A can INSERT own blocked_date'
);

RESET ROLE;

-- 3. Artist A can DELETE own blocked_date
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM public.blocked_dates
WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  0,
  'artist A can DELETE own blocked_date'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Cross-artist isolation (the key data-exposure guard)
-- ────────────────────────────────────────────────────────────────────────────

-- 4. Artist B cannot SELECT artist A's blocked_date (USING artist→user check).
--    Queries artist A's surviving row (eeeeeeee-eeee-0003) under artist B's JWT;
--    the row exists, so count = 0 can only come from the RLS USING clause.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000'),
  0,
  'artist B cannot SELECT artist A blocked_date'
);

RESET ROLE;

-- 5. Artist A cannot SELECT artist B's blocked_date
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  0,
  'artist A cannot see artist B blocked_date'
);

RESET ROLE;

-- 6. Artist A cannot INSERT a blocked_date for artist B (WITH CHECK violation)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.blocked_dates (artist_id, date, reason)
    VALUES ('bbbbbbbb-bbbb-0002-0000-000000000000', '2099-03-20', 'A blocks B')$$,
  '42501',
  null,
  'artist A cannot INSERT a blocked_date for artist B (WITH CHECK violation)'
);

RESET ROLE;

-- 7. Artist A cannot DELETE artist B's blocked_date (USING blocks it → 0 rows)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM public.blocked_dates
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'artist B blocked_date unchanged — USING blocked artist A delete'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Admin / producer read access
-- ────────────────────────────────────────────────────────────────────────────

-- 8. Admin can SELECT artist B's blocked_date
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'admin can SELECT artist B blocked_date'
);

RESET ROLE;

-- 9. Producer can SELECT artist B's blocked_date
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'producer can SELECT artist B blocked_date'
);

RESET ROLE;

-- 10. Producer cannot DELETE a blocked_date (view-only policy; no write policy)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM public.blocked_dates
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.blocked_dates
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'producer cannot DELETE blocked_date — view-only policy, no write grant'
);

SELECT * FROM finish();
ROLLBACK;
