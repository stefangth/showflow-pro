-- pgTAP: a skill required by a production/date cannot be deleted (RESTRICT),
-- while a skill only held by artists stays deletable (artist_skills CASCADE).
BEGIN;
SELECT plan(3);

SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'show_required_skills_skill_id_fkey'),
  'r', 'show_required_skills.skill_id is ON DELETE RESTRICT');
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'show_date_required_skills_skill_id_fkey'),
  'r', 'show_date_required_skills.skill_id is ON DELETE RESTRICT');
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'artist_skills_skill_id_fkey'),
  'c', 'artist_skills.skill_id stays ON DELETE CASCADE');

SELECT * FROM finish();
ROLLBACK;
