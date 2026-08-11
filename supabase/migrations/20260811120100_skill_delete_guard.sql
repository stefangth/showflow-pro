-- Deleting a skill must not silently drop the requirements that reference it.
-- The new Skills catalog card only offers delete when nothing requires the skill;
-- this makes that a hard DB guarantee: flip the required-skill FKs from CASCADE to
-- RESTRICT so the database blocks deleting a skill any production or date still
-- requires. artist_skills stays ON DELETE CASCADE, so a skill that is only *held*
-- by artists (and required nowhere) can still be deleted, taking it off those
-- artists -- matching the design's "Not required by any production -- safe to delete".
--
-- The show_id / show_date_id FKs on these tables remain ON DELETE CASCADE, so
-- deleting a show or date still cascades away its requirement rows; only deleting
-- the referenced SKILL is now restricted.
--
-- The FK constraint is looked up dynamically (by catalog inspection, not a literal
-- name with no IF EXISTS) so this migration does not depend on Postgres's
-- auto-generated name always matching `<table>_skill_id_fkey` -- it drops whatever
-- FK it actually finds on skill_id -> skills, then recreates it under the
-- conventional name with ON DELETE RESTRICT.

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'public.show_required_skills'::regclass AND contype = 'f'
     AND confrelid = 'public.skills'::regclass
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'public.show_required_skills'::regclass
                            AND attname = 'skill_id')];
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.show_required_skills DROP CONSTRAINT %I', v_name);
  END IF;
  ALTER TABLE public.show_required_skills
    ADD CONSTRAINT show_required_skills_skill_id_fkey
      FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE RESTRICT;
END $$;

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'public.show_date_required_skills'::regclass AND contype = 'f'
     AND confrelid = 'public.skills'::regclass
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'public.show_date_required_skills'::regclass
                            AND attname = 'skill_id')];
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.show_date_required_skills DROP CONSTRAINT %I', v_name);
  END IF;
  ALTER TABLE public.show_date_required_skills
    ADD CONSTRAINT show_date_required_skills_skill_id_fkey
      FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE RESTRICT;
END $$;
