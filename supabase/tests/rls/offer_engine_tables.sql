-- RLS tests for the offer-engine support tables:
--   public.cast_city_priority
--   public.show_date_offer_tiers
--   public.show_date_cast_eligibility
--
-- Policies under test (source migrations):
--   cast_city_priority (20260514170000):
--     "Admins and producers can view cast_city_priority"   — SELECT, admin/producer only
--     "Admins and producers can insert cast_city_priority" — INSERT, admin/producer only
--     "Admins and producers can update cast_city_priority" — UPDATE, admin/producer only
--     "Admins and producers can delete cast_city_priority" — DELETE, admin/producer only
--     (no policy grants the artist role anything → artist sees/writes nothing)
--   show_date_offer_tiers (20260514180000):
--     "Admins and producers can manage show_date_offer_tiers" — FOR ALL, admin/producer
--     "Artists can view show_date_offer_tiers"                — SELECT, USING (true)
--   show_date_cast_eligibility (20260421170151):
--     "Authenticated can view show date cast eligibility"          — SELECT, USING (true)
--     "Admins and producers can insert show date cast eligibility" — INSERT, admin/producer
--     "Admins and producers can delete show date cast eligibility" — DELETE, admin/producer
--
-- UUID legend (all IDs are test-only, rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist user
--   bbbbbbbb-bbbb-0001-…  artist profile row
--   cccccccc-cccc-0001-…  show
--   cccccccc-cccc-0002-…  cast
--   cccccccc-cccc-0003-…  city
--   dddddddd-dddd-0001-…  show_date
--   eeeeeeee-eeee-0001-…  cast_city_priority row
--   eeeeeeee-eeee-0002-…  show_date_offer_tiers row
--   eeeeeeee-eeee-0003-…  show_date_cast_eligibility row

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup (as postgres superuser)
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-oe-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-oe-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-oe-artist@test.com',   now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());


-- Phase 1B: org-scoped role-gating — mirror roles as bootstrap-org memberships.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id) VALUES
  ('bbbbbbbb-bbbb-0001-0000-000000000000', 'OE Artist', 'aaaaaaaa-aaaa-0003-0000-000000000000');

INSERT INTO public.shows (id, program, sub_program)
VALUES ('cccccccc-cccc-0001-0000-000000000000', 'theatre', 'musical');

INSERT INTO public.casts (id, name)
VALUES ('cccccccc-cccc-0002-0000-000000000000', 'OE Cast');

INSERT INTO public.cities (id, name) VALUES
  ('cccccccc-cccc-0003-0000-000000000000', 'OE City'),
  -- second city used by test 2's producer INSERT so the (cast_id, city_id)
  -- unique constraint is not violated against the seeded priority-1 row
  ('cccccccc-cccc-0004-0000-000000000000', 'OE City Two');

INSERT INTO public.show_dates (id, show_id, date, session_1) VALUES
  ('dddddddd-dddd-0001-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-04-01', '20:00'::time),
  -- second date used in test 10 so the (show_date_id, cast_id) unique constraint holds
  ('dddddddd-dddd-0002-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-04-02', '20:00'::time);

INSERT INTO public.cast_city_priority (id, cast_id, city_id, priority)
VALUES ('eeeeeeee-eeee-0001-0000-000000000000', 'cccccccc-cccc-0002-0000-000000000000', 'cccccccc-cccc-0003-0000-000000000000', 1);

INSERT INTO public.show_date_offer_tiers (id, show_date_id, tier)
VALUES ('eeeeeeee-eeee-0002-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 1);

INSERT INTO public.show_date_cast_eligibility (id, show_date_id, cast_id)
VALUES ('eeeeeeee-eeee-0003-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'cccccccc-cccc-0002-0000-000000000000');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- cast_city_priority — admin/producer only; artist has no access
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Admin can SELECT cast_city_priority
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.cast_city_priority
   WHERE id = 'eeeeeeee-eeee-0001-0000-000000000000'),
  1,
  'admin can SELECT cast_city_priority'
);

RESET ROLE;

-- 2. Producer can INSERT cast_city_priority
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.cast_city_priority (cast_id, city_id, priority)
    VALUES ('cccccccc-cccc-0002-0000-000000000000', 'cccccccc-cccc-0004-0000-000000000000', 2)$$,
  'producer can INSERT cast_city_priority'
);

RESET ROLE;

-- 3. Artist cannot SELECT cast_city_priority (no policy grants artist access)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.cast_city_priority),
  0,
  'artist sees zero cast_city_priority rows'
);

RESET ROLE;

-- 4. Artist cannot INSERT cast_city_priority
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.cast_city_priority (cast_id, city_id, priority)
    VALUES ('cccccccc-cccc-0002-0000-000000000000', 'cccccccc-cccc-0003-0000-000000000000', 3)$$,
  '42501',
  null,
  'artist cannot INSERT cast_city_priority'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- show_date_offer_tiers — artist may SELECT; only admin/producer may write
-- ────────────────────────────────────────────────────────────────────────────

-- 5. Artist can SELECT show_date_offer_tiers (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.show_date_offer_tiers
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'artist can SELECT show_date_offer_tiers'
);

RESET ROLE;

-- 6. Producer can INSERT show_date_offer_tiers
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.show_date_offer_tiers (show_date_id, tier)
    VALUES ('dddddddd-dddd-0001-0000-000000000000', 2)$$,
  'producer can INSERT show_date_offer_tiers'
);

RESET ROLE;

-- 7. Artist cannot INSERT show_date_offer_tiers (manage policy is admin/producer)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.show_date_offer_tiers (show_date_id, tier)
    VALUES ('dddddddd-dddd-0001-0000-000000000000', 3)$$,
  '42501',
  null,
  'artist cannot INSERT show_date_offer_tiers'
);

RESET ROLE;

-- 8. Artist cannot DELETE show_date_offer_tiers (USING blocks it → 0 rows)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM public.show_date_offer_tiers
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.show_date_offer_tiers
   WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000'),
  1,
  'show_date_offer_tiers unchanged — manage USING blocked artist delete'
);

-- ────────────────────────────────────────────────────────────────────────────
-- show_date_cast_eligibility — any authenticated may SELECT; admin/producer write
-- ────────────────────────────────────────────────────────────────────────────

-- 9. Artist can SELECT show_date_cast_eligibility (USING true)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.show_date_cast_eligibility
   WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000'),
  1,
  'artist can SELECT show_date_cast_eligibility'
);

RESET ROLE;

-- 10. Admin can INSERT show_date_cast_eligibility
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Uses the second show_date seeded above so the (show_date_id, cast_id)
-- unique constraint holds.
SELECT lives_ok(
  $$INSERT INTO public.show_date_cast_eligibility (show_date_id, cast_id)
    VALUES ('dddddddd-dddd-0002-0000-000000000000', 'cccccccc-cccc-0002-0000-000000000000')$$,
  'admin can INSERT show_date_cast_eligibility'
);

RESET ROLE;

-- 11. Artist cannot INSERT show_date_cast_eligibility
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.show_date_cast_eligibility (show_date_id, cast_id)
    VALUES ('dddddddd-dddd-0001-0000-000000000000', 'cccccccc-cccc-0002-0000-000000000000')$$,
  '42501',
  null,
  'artist cannot INSERT show_date_cast_eligibility'
);

RESET ROLE;

-- 12. Artist cannot DELETE show_date_cast_eligibility (USING blocks it → 0 rows)
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM public.show_date_cast_eligibility
WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000';

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.show_date_cast_eligibility
   WHERE id = 'eeeeeeee-eeee-0003-0000-000000000000'),
  1,
  'show_date_cast_eligibility unchanged — delete USING blocked artist'
);

SELECT * FROM finish();
ROLLBACK;
