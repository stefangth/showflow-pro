-- Soft-archive for skills. NULL = active, non-NULL = archived: hidden from every
-- picker but kept on the artists who hold it and on any required-skill rows.
-- Complements the existing (previously unused) admin/producer UPDATE and admin
-- DELETE policies on skills, which the new Skills catalog card now exercises.
ALTER TABLE public.skills
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Partial index: pickers read active skills per org (archived excluded).
CREATE INDEX IF NOT EXISTS idx_skills_org_active
  ON public.skills (org_id) WHERE archived_at IS NULL;

COMMENT ON COLUMN public.skills.archived_at IS
  'When set, the skill is archived: hidden from every picker but retained on artist_skills and required-skill rows.';
