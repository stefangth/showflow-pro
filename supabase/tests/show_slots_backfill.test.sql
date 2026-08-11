-- backfill_show_slots_from_legacy(): seed one Main/Understudy slot per existing
-- show so shows.main_cast_slots/understudy_slots and show_required_skills read
-- back EXACTLY their pre-backfill values. The load-bearing invariant: a NULL
-- count stays NULL (never flips to 0), and the required-skill set is preserved.
--
--   66666666-...-0003 org
--   77777777-...-0003-...0001 Show A  main=3 understudy=2 + Vocals,Stage combat
--   77777777-...-0003-...0002 Show B  NULL/NULL, no skills
--   77777777-...-0003-...0003 Show C  main=NULL understudy=1 + Vocals
--   77777777-...-0003-...0004 Show D  NULL/NULL but HAS a required skill (orphan)
--   88888888-...-0003-...0001 skill Vocals   88888888-...-0003-...0002 Stage combat
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('66666666-0003-4003-8003-000000000001','Show Slots Backfill Org','show-slots-backfill-org');

-- Legacy shows carrying the caches directly (as every pre-Plan-B show does).
INSERT INTO public.shows (id, org_id, program, main_cast_slots, understudy_slots) VALUES
  ('77777777-0003-4003-8003-000000000001','66666666-0003-4003-8003-000000000001','Show A', 3,    2),
  ('77777777-0003-4003-8003-000000000002','66666666-0003-4003-8003-000000000001','Show B', NULL, NULL),
  ('77777777-0003-4003-8003-000000000003','66666666-0003-4003-8003-000000000001','Show C', NULL, 1),
  ('77777777-0003-4003-8003-000000000004','66666666-0003-4003-8003-000000000001','Show D', NULL, NULL);

INSERT INTO public.skills (id, org_id, name) VALUES
  ('88888888-0003-4003-8003-000000000001','66666666-0003-4003-8003-000000000001','Vocals'),
  ('88888888-0003-4003-8003-000000000002','66666666-0003-4003-8003-000000000001','Stage combat');

-- Legacy required skills, attached the old (show-level) way. Backfill must move
-- them onto a slot for A and C, and must leave D's alone (D has no slot to take them).
INSERT INTO public.show_required_skills (show_id, skill_id) VALUES
  ('77777777-0003-4003-8003-000000000001','88888888-0003-4003-8003-000000000001'),
  ('77777777-0003-4003-8003-000000000001','88888888-0003-4003-8003-000000000002'),
  ('77777777-0003-4003-8003-000000000003','88888888-0003-4003-8003-000000000001'),
  ('77777777-0003-4003-8003-000000000004','88888888-0003-4003-8003-000000000001');

-- Sanity: these shows have no show_slots yet, so backfill will process them.
SELECT public.backfill_show_slots_from_legacy();

-- Show A: caches read back byte-for-byte unchanged.
SELECT is(
  (SELECT main_cast_slots FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000001'),
  3::smallint, 'A: main_cast_slots still 3 after backfill');
SELECT is(
  (SELECT understudy_slots FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000001'),
  2::smallint, 'A: understudy_slots still 2 after backfill');
SELECT is(
  (SELECT count(*)::int FROM public.show_required_skills
   WHERE show_id = '77777777-0003-4003-8003-000000000001'),
  2, 'A: show_required_skills still has exactly 2 rows');
SELECT ok(
  (SELECT bool_and(skill_id IN ('88888888-0003-4003-8003-000000000001','88888888-0003-4003-8003-000000000002'))
   FROM public.show_required_skills WHERE show_id = '77777777-0003-4003-8003-000000000001'),
  'A: show_required_skills still exactly {Vocals, Stage combat}');

-- Show A: the slot rows now exist (Main cast(3) + Understudy(2)).
SELECT is(
  (SELECT count(*)::int FROM public.show_slots
   WHERE show_id = '77777777-0003-4003-8003-000000000001'),
  2, 'A: two show_slots rows created');
SELECT is(
  (SELECT count(*)::int FROM public.show_slots
   WHERE show_id = '77777777-0003-4003-8003-000000000001'
     AND kind = 'main' AND slot_count = 3 AND name = 'Main cast'),
  1, 'A: a Main cast slot with count 3 exists');
SELECT is(
  (SELECT count(*)::int FROM public.show_slots
   WHERE show_id = '77777777-0003-4003-8003-000000000001'
     AND kind = 'understudy' AND slot_count = 2 AND name = 'Understudy'),
  1, 'A: an Understudy slot with count 2 exists');

-- Show A: both legacy required skills attach to the MAIN slot, none to understudy.
SELECT is(
  (SELECT count(*)::int FROM public.show_slot_required_skills ssrs
   JOIN public.show_slots ss ON ss.id = ssrs.slot_id
   WHERE ss.show_id = '77777777-0003-4003-8003-000000000001' AND ss.kind = 'main'),
  2, 'A: both required skills attach to the Main cast slot');
SELECT is(
  (SELECT count(*)::int FROM public.show_slot_required_skills ssrs
   JOIN public.show_slots ss ON ss.id = ssrs.slot_id
   WHERE ss.show_id = '77777777-0003-4003-8003-000000000001' AND ss.kind = 'understudy'),
  0, 'A: nothing attaches to the Understudy slot');

-- Show B: NULL/NULL with no skills stays entirely unconfigured.
SELECT is(
  (SELECT count(*)::int FROM public.show_slots WHERE show_id = '77777777-0003-4003-8003-000000000002'),
  0, 'B: no show_slots created for an empty NULL/NULL show');
SELECT ok(
  (SELECT main_cast_slots IS NULL AND understudy_slots IS NULL
   FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000002'),
  'B: both counts remain NULL (never flipped to 0)');

-- Show C: main NULL, understudy=1, one skill -> skill attaches to the Understudy slot.
SELECT is(
  (SELECT understudy_slots FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000003'),
  1::smallint, 'C: understudy_slots still 1');
SELECT ok(
  (SELECT main_cast_slots IS NULL FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000003'),
  'C: main_cast_slots stays NULL (no main slot created)');
SELECT is(
  (SELECT count(*)::int FROM public.show_slot_required_skills ssrs
   JOIN public.show_slots ss ON ss.id = ssrs.slot_id
   WHERE ss.show_id = '77777777-0003-4003-8003-000000000003' AND ss.kind = 'understudy'),
  1, 'C: the required skill attaches to the Understudy slot');
SELECT is(
  (SELECT count(*)::int FROM public.show_slots
   WHERE show_id = '77777777-0003-4003-8003-000000000003' AND kind = 'main'),
  0, 'C: no main slot was created');

-- Show D: NULL/NULL but HAS a required skill. The orphan branch must leave it
-- untouched -- no slots, counts stay NULL, and the required skill is preserved
-- (recompute must NOT run for it, or it would wipe the skill).
SELECT is(
  (SELECT count(*)::int FROM public.show_slots WHERE show_id = '77777777-0003-4003-8003-000000000004'),
  0, 'D: no show_slots created for the both-NULL-with-skills orphan');
SELECT ok(
  (SELECT main_cast_slots IS NULL AND understudy_slots IS NULL
   FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000004'),
  'D: both counts remain NULL (no count flip)');
SELECT is(
  (SELECT count(*)::int FROM public.show_required_skills
   WHERE show_id = '77777777-0003-4003-8003-000000000004'),
  1, 'D: the orphan show keeps its show_required_skills untouched');

-- Idempotency: a second run is a no-op (every show now has show_slots or was skipped).
SELECT public.backfill_show_slots_from_legacy();
SELECT is(
  (SELECT count(*)::int FROM public.show_slots WHERE show_id = '77777777-0003-4003-8003-000000000001'),
  2, 'idempotent: A still has exactly 2 show_slots after a second run');
SELECT ok(
  (SELECT main_cast_slots = 3 AND understudy_slots = 2
   FROM public.shows WHERE id = '77777777-0003-4003-8003-000000000001'),
  'idempotent: A caches unchanged after a second run');
SELECT is(
  (SELECT count(*)::int FROM public.show_slot_required_skills ssrs
   JOIN public.show_slots ss ON ss.id = ssrs.slot_id
   WHERE ss.show_id = '77777777-0003-4003-8003-000000000001'),
  2, 'idempotent: no duplicate slot-skill attachments after a second run');

SELECT * FROM finish();
ROLLBACK;
