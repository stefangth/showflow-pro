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

ALTER TABLE public.show_required_skills
  DROP CONSTRAINT show_required_skills_skill_id_fkey,
  ADD CONSTRAINT show_required_skills_skill_id_fkey
    FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE RESTRICT;

ALTER TABLE public.show_date_required_skills
  DROP CONSTRAINT show_date_required_skills_skill_id_fkey,
  ADD CONSTRAINT show_date_required_skills_skill_id_fkey
    FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE RESTRICT;
