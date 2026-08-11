-- recompute_show_slot_derivations: shows.main_cast_slots/understudy_slots and
-- show_required_skills stay in sync with show_slots + show_slot_required_skills.
--   66666666-…-0001 org   77777777-…-0001 show
--   88888888-…-0001 skill "Vocals"   88888888-…-0002 skill "Stage combat"
--   99999999-…-0001 main slot        99999999-…-0002 understudy slot
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('66666666-0002-4002-8002-000000000001','Show Slots Derivation Org','show-slots-derivation-org');

-- Show starts with no slots configured (NULL/NULL).
INSERT INTO public.shows (id, org_id, program) VALUES
  ('77777777-0002-4002-8002-000000000001','66666666-0002-4002-8002-000000000001','Derivation Test Show');

INSERT INTO public.skills (id, org_id, name) VALUES
  ('88888888-0002-4002-8002-000000000001','66666666-0002-4002-8002-000000000001','Vocals'),
  ('88888888-0002-4002-8002-000000000002','66666666-0002-4002-8002-000000000001','Stage combat');

-- 1. Baseline: an un-slotted show has NULL caches (nothing to derive from yet).
SELECT ok(
  (SELECT main_cast_slots IS NULL AND understudy_slots IS NULL
   FROM public.shows WHERE id = '77777777-0002-4002-8002-000000000001'),
  'a show with no slots starts with NULL main_cast_slots/understudy_slots');

-- Insert a main slot (count 3) and an understudy slot (count 2).
INSERT INTO public.show_slots (id, show_id, name, slot_count, kind, sort_order) VALUES
  ('99999999-0002-4002-8002-000000000001','77777777-0002-4002-8002-000000000001','Main cast',3,'main',0),
  ('99999999-0002-4002-8002-000000000002','77777777-0002-4002-8002-000000000001','Understudies',2,'understudy',1);

-- Attach both skills to the main slot, and one (Vocals) to the understudy slot.
INSERT INTO public.show_slot_required_skills (slot_id, skill_id) VALUES
  ('99999999-0002-4002-8002-000000000001','88888888-0002-4002-8002-000000000001'),
  ('99999999-0002-4002-8002-000000000001','88888888-0002-4002-8002-000000000002'),
  ('99999999-0002-4002-8002-000000000002','88888888-0002-4002-8002-000000000001');

-- 2-3. shows.main_cast_slots/understudy_slots recompute from the slot rows.
SELECT is(
  (SELECT main_cast_slots FROM public.shows WHERE id = '77777777-0002-4002-8002-000000000001'),
  3::smallint, 'main_cast_slots = sum of main slot counts (3)');
SELECT is(
  (SELECT understudy_slots FROM public.shows WHERE id = '77777777-0002-4002-8002-000000000001'),
  2::smallint, 'understudy_slots = sum of understudy slot counts (2)');

-- 4. show_required_skills is the deduped union of both slots' skills (2, not 3).
SELECT is(
  (SELECT count(*)::int FROM public.show_required_skills
   WHERE show_id = '77777777-0002-4002-8002-000000000001'),
  2, 'show_required_skills is the deduped union of slot skills (2 rows)');
SELECT ok(
  (SELECT bool_and(skill_id IN ('88888888-0002-4002-8002-000000000001','88888888-0002-4002-8002-000000000002'))
   FROM public.show_required_skills WHERE show_id = '77777777-0002-4002-8002-000000000001'),
  'show_required_skills contains exactly Vocals and Stage combat');

-- 6. A SECOND main slot proves main_cast_slots is a SUM across rows, not a
-- single slot's count (a max()/LIMIT-1 implementation would fail this).
INSERT INTO public.show_slots (id, show_id, name, slot_count, kind, sort_order) VALUES
  ('99999999-0002-4002-8002-000000000003','77777777-0002-4002-8002-000000000001','Main cast (2)',2,'main',2);
SELECT is(
  (SELECT main_cast_slots FROM public.shows WHERE id = '77777777-0002-4002-8002-000000000001'),
  5::smallint, 'main_cast_slots sums across multiple main slot rows (3 + 2 = 5)');
-- Clean up: remove the second slot so the rest of the test's arithmetic
-- (single main slot going 3 -> 5 below) is unaffected.
DELETE FROM public.show_slots WHERE id = '99999999-0002-4002-8002-000000000003';

-- 7. Updating the main slot's count recomputes main_cast_slots.
UPDATE public.show_slots SET slot_count = 5
  WHERE id = '99999999-0002-4002-8002-000000000001';
SELECT is(
  (SELECT main_cast_slots FROM public.shows WHERE id = '77777777-0002-4002-8002-000000000001'),
  5::smallint, 'updating the main slot count recomputes main_cast_slots (5)');

-- 8. Deleting the last understudy slot sets understudy_slots back to NULL
-- (sum() over zero rows is NULL -- the unconfigured state, not 0).
DELETE FROM public.show_slots WHERE id = '99999999-0002-4002-8002-000000000002';
SELECT ok(
  (SELECT understudy_slots IS NULL FROM public.shows WHERE id = '77777777-0002-4002-8002-000000000001'),
  'deleting the last understudy slot sets understudy_slots back to NULL');

-- 9. That delete cascades its slot skill (Vocals on the understudy slot) away,
-- but Vocals is still required via the main slot, so the union is unaffected (still 2).
SELECT is(
  (SELECT count(*)::int FROM public.show_required_skills
   WHERE show_id = '77777777-0002-4002-8002-000000000001'),
  2, 'show_required_skills unaffected by the understudy slot delete (Vocals still required via the main slot)');

-- 10. Deleting a slot skill (Stage combat off the main slot) shrinks the union to 1,
-- leaving only Vocals.
DELETE FROM public.show_slot_required_skills
  WHERE slot_id = '99999999-0002-4002-8002-000000000001'
    AND skill_id = '88888888-0002-4002-8002-000000000002';
SELECT is(
  (SELECT skill_id::text FROM public.show_required_skills
   WHERE show_id = '77777777-0002-4002-8002-000000000001'),
  '88888888-0002-4002-8002-000000000001',
  'show_required_skills shrinks to the remaining union after a slot skill is deleted');

SELECT * FROM finish();
ROLLBACK;
