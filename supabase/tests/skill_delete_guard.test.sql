-- pgTAP: a skill required by a production/date cannot be deleted (RESTRICT),
-- while a skill only held by artists stays deletable (artist_skills CASCADE).
BEGIN;
SELECT plan(5);

SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'show_required_skills_skill_id_fkey'),
  'r', 'show_required_skills.skill_id is ON DELETE RESTRICT');
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'show_date_required_skills_skill_id_fkey'),
  'r', 'show_date_required_skills.skill_id is ON DELETE RESTRICT');
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'artist_skills_skill_id_fkey'),
  'c', 'artist_skills.skill_id stays ON DELETE CASCADE');

-- Behavioral fixtures, attached to the Bootstrap Org's seeded show/artist
-- (00000000-0000-0000-0000-00000000b007, from supabase/seed.sql).
INSERT INTO public.skills (id, org_id, name) VALUES
  ('aaaaaaaa-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000b007', 'pgTAP required skill'),
  ('aaaaaaaa-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000b007', 'pgTAP artist-only skill');

INSERT INTO public.show_required_skills (org_id, show_id, skill_id) VALUES (
  '00000000-0000-0000-0000-00000000b007',
  (SELECT id FROM public.shows WHERE org_id = '00000000-0000-0000-0000-00000000b007' LIMIT 1),
  'aaaaaaaa-1111-1111-1111-111111111111'
);

INSERT INTO public.artist_skills (org_id, artist_id, skill_id) VALUES (
  '00000000-0000-0000-0000-00000000b007',
  (SELECT id FROM public.artists WHERE org_id = '00000000-0000-0000-0000-00000000b007' LIMIT 1),
  'aaaaaaaa-2222-2222-2222-222222222222'
);

-- A skill required by a production cannot be deleted: the RESTRICT FK rejects it.
SELECT throws_ok(
  $$ DELETE FROM public.skills WHERE id = 'aaaaaaaa-1111-1111-1111-111111111111' $$,
  '23503', NULL,
  'deleting a skill required by a production is rejected'
);

-- A skill only held by artists (required by no production/date) deletes cleanly,
-- cascading off the artist_skills row per ON DELETE CASCADE.
SELECT lives_ok(
  $$ DELETE FROM public.skills WHERE id = 'aaaaaaaa-2222-2222-2222-222222222222' $$,
  'an artist-only skill, not required by any production or date, deletes'
);

SELECT * FROM finish();
ROLLBACK;
