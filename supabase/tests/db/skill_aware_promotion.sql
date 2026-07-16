-- Skill-aware understudy promotion (booking flow phase 4):
-- promote_understudy_on_cancellation() candidate ORDER BY now prefers the
-- understudy whose artist_skills best cover the cancelled artist's skills
-- (count of shared skill rows, descending) before the existing oldest-first
-- tie-break. See migration 20260715130100_skill_aware_understudy_promotion.sql.
--
-- No app_settings rows are seeded, so booking_flow resolves to code defaults:
-- understudy_promotion = true, artist_acceptance = true. Only soft_booked
-- understudies are eligible candidates.
--
-- UUID legend (all test-only, rolled back at end), prefix e11b:
--   e11b...00a       org
--   e11b...5a        show
--   e11b...d1/d2/d3  show_dates, one per scenario (kept separate so the
--                    candidate pools never mix across assertions)
--   e11b...541       skill (judge)
--   e11b...0001-0009 artists (Main N / U(2N-1) / U(2N) per scenario)
--   e11b...0101-0303 bookings (scenario prefix 1/2/3, then 01=main, 02/03=understudies)
--
-- All artists get user_id = NULL so the promotion function's notification
-- INSERT (which selects only rows with a non-null artist user_id) is a no-op.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.organizations (id, name, slug) VALUES
  ('e11b0000-0000-0000-0000-00000000000a', 'Skill Promo Org', 'skill-promo-org');

INSERT INTO public.shows (id, org_id, program, sub_program) VALUES
  ('e11b0000-0000-0000-0000-00000000005a', 'e11b0000-0000-0000-0000-00000000000a', 'theatre', 'musical');

INSERT INTO public.show_dates (id, org_id, show_id, date, session_1) VALUES
  ('e11b0000-0000-0000-0000-0000000000d1', 'e11b0000-0000-0000-0000-00000000000a', 'e11b0000-0000-0000-0000-00000000005a', '2099-09-01', '19:00'::time),
  ('e11b0000-0000-0000-0000-0000000000d2', 'e11b0000-0000-0000-0000-00000000000a', 'e11b0000-0000-0000-0000-00000000005a', '2099-09-02', '19:00'::time),
  ('e11b0000-0000-0000-0000-0000000000d3', 'e11b0000-0000-0000-0000-00000000000a', 'e11b0000-0000-0000-0000-00000000005a', '2099-09-03', '19:00'::time);

INSERT INTO public.skills (id, org_id, name) VALUES
  ('e11b0000-0000-0000-0000-000000000541', 'e11b0000-0000-0000-0000-00000000000a', 'judge');

-- Artists: all user_id NULL. Scenario 1 = skill match wins over age; scenario 2 =
-- neither understudy has skills (regression guard, oldest-first); scenario 3 =
-- both understudies share the cancelled artist's skill (coverage tie, age tie-break).
INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('e11b0000-0000-0000-0000-000000000001', 'Skill Promo Main 1', NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000002', 'Skill Promo U1',     NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000003', 'Skill Promo U2',     NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000004', 'Skill Promo Main 2', NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000005', 'Skill Promo U3',     NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000006', 'Skill Promo U4',     NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000007', 'Skill Promo Main 3', NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000008', 'Skill Promo U5',     NULL, 'e11b0000-0000-0000-0000-00000000000a'),
  ('e11b0000-0000-0000-0000-000000000009', 'Skill Promo U6',     NULL, 'e11b0000-0000-0000-0000-00000000000a');

-- Scenario 1: Main 1 and U2 share "judge"; U1 has no skills.
-- Scenario 2: nobody has a skill row.
-- Scenario 3: Main 3, U5 and U6 all share "judge".
INSERT INTO public.artist_skills (artist_id, skill_id) VALUES
  ('e11b0000-0000-0000-0000-000000000001', 'e11b0000-0000-0000-0000-000000000541'),
  ('e11b0000-0000-0000-0000-000000000003', 'e11b0000-0000-0000-0000-000000000541'),
  ('e11b0000-0000-0000-0000-000000000007', 'e11b0000-0000-0000-0000-000000000541'),
  ('e11b0000-0000-0000-0000-000000000008', 'e11b0000-0000-0000-0000-000000000541'),
  ('e11b0000-0000-0000-0000-000000000009', 'e11b0000-0000-0000-0000-000000000541');

-- Main artist booking = confirmed, is_understudy = false.
-- Understudies = soft_booked, is_understudy = true, staggered created_at
-- (older understudy first, newer understudy second).
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, created_at) VALUES
  ('e11b0000-0000-0000-0000-000000000101', 'e11b0000-0000-0000-0000-0000000000d1', 'e11b0000-0000-0000-0000-000000000001', 'confirmed',   false, now() - interval '3 days'),
  ('e11b0000-0000-0000-0000-000000000102', 'e11b0000-0000-0000-0000-0000000000d1', 'e11b0000-0000-0000-0000-000000000002', 'soft_booked', true,  now() - interval '2 days'),
  ('e11b0000-0000-0000-0000-000000000103', 'e11b0000-0000-0000-0000-0000000000d1', 'e11b0000-0000-0000-0000-000000000003', 'soft_booked', true,  now() - interval '1 day'),

  ('e11b0000-0000-0000-0000-000000000201', 'e11b0000-0000-0000-0000-0000000000d2', 'e11b0000-0000-0000-0000-000000000004', 'confirmed',   false, now() - interval '3 days'),
  ('e11b0000-0000-0000-0000-000000000202', 'e11b0000-0000-0000-0000-0000000000d2', 'e11b0000-0000-0000-0000-000000000005', 'soft_booked', true,  now() - interval '2 days'),
  ('e11b0000-0000-0000-0000-000000000203', 'e11b0000-0000-0000-0000-0000000000d2', 'e11b0000-0000-0000-0000-000000000006', 'soft_booked', true,  now() - interval '1 day'),

  ('e11b0000-0000-0000-0000-000000000301', 'e11b0000-0000-0000-0000-0000000000d3', 'e11b0000-0000-0000-0000-000000000007', 'confirmed',   false, now() - interval '3 days'),
  ('e11b0000-0000-0000-0000-000000000302', 'e11b0000-0000-0000-0000-0000000000d3', 'e11b0000-0000-0000-0000-000000000008', 'soft_booked', true,  now() - interval '2 days'),
  ('e11b0000-0000-0000-0000-000000000303', 'e11b0000-0000-0000-0000-0000000000d3', 'e11b0000-0000-0000-0000-000000000009', 'soft_booked', true,  now() - interval '1 day');

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Skill match wins over age: cancelling Main 1 (has "judge") promotes U2
--    (newer, has "judge") instead of U1 (older, no skills).
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'e11b0000-0000-0000-0000-000000000101';

SELECT ok(
  (SELECT status = 'confirmed'::booking_status AND is_understudy = false
   FROM public.bookings WHERE id = 'e11b0000-0000-0000-0000-000000000103')
  AND
  (SELECT status = 'soft_booked'::booking_status AND is_understudy = true
   FROM public.bookings WHERE id = 'e11b0000-0000-0000-0000-000000000102'),
  'skill match wins over age: skilled newer understudy (U2) promoted, unskilled older understudy (U1) left untouched');

-- ────────────────────────────────────────────────────────────────────────────
-- 2. No skills on the cancelled artist keeps oldest-first: cancelling Main 2
--    (no skills) promotes U3 (older) over U4 (newer); both tie at zero shared
--    skills, which reproduces the pre-change ordering exactly.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'e11b0000-0000-0000-0000-000000000201';

SELECT ok(
  (SELECT status = 'confirmed'::booking_status AND is_understudy = false
   FROM public.bookings WHERE id = 'e11b0000-0000-0000-0000-000000000202')
  AND
  (SELECT status = 'soft_booked'::booking_status AND is_understudy = true
   FROM public.bookings WHERE id = 'e11b0000-0000-0000-0000-000000000203'),
  'no skills on the cancelled artist keeps oldest-first (regression guard for pre-change behavior)');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Coverage ties break by age: cancelling Main 3 (has "judge") promotes U5
--    (older, has "judge") over U6 (newer, has "judge"); both tie at one shared
--    skill, so the age tie-break decides.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings SET status = 'cancelled'
WHERE id = 'e11b0000-0000-0000-0000-000000000301';

SELECT ok(
  (SELECT status = 'confirmed'::booking_status AND is_understudy = false
   FROM public.bookings WHERE id = 'e11b0000-0000-0000-0000-000000000302')
  AND
  (SELECT status = 'soft_booked'::booking_status AND is_understudy = true
   FROM public.bookings WHERE id = 'e11b0000-0000-0000-0000-000000000303'),
  'coverage ties break by age: older equally-skilled understudy (U5) promoted over the newer one (U6)');

SELECT * FROM finish();
ROLLBACK;
