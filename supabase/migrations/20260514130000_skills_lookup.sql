-- Canonical skills lookup + artist_skills join table.
-- Backfills from the existing artists.skills text[] mirror, which is then dropped.

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artist_skills (
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_id, skill_id)
);

CREATE INDEX idx_artist_skills_skill ON artist_skills(skill_id);

-- Backfill canonical skills from existing array column.
INSERT INTO skills (name)
SELECT DISTINCT trim(s)
FROM artists a, unnest(a.skills) AS s
WHERE a.skills IS NOT NULL AND trim(s) != ''
ON CONFLICT (name) DO NOTHING;

-- Backfill join rows.
INSERT INTO artist_skills (artist_id, skill_id)
SELECT a.id, sk.id
FROM artists a, unnest(a.skills) AS s
JOIN skills sk ON sk.name = trim(s)
WHERE a.skills IS NOT NULL AND trim(s) != ''
ON CONFLICT DO NOTHING;

-- Drop the denormalised array column now that the join is authoritative.
ALTER TABLE artists DROP COLUMN IF EXISTS skills;

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skills_read_all" ON skills
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "skills_write_admin_or_producer" ON skills
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'producer'::app_role)
  );

CREATE POLICY "skills_update_admin_or_producer" ON skills
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'producer'::app_role)
  );

CREATE POLICY "skills_delete_admin" ON skills
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "artist_skills_read_all" ON artist_skills
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "artist_skills_write_admin_or_producer" ON artist_skills
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'producer'::app_role)
  );

CREATE POLICY "artist_skills_delete_admin_or_producer" ON artist_skills
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'producer'::app_role)
  );

ALTER PUBLICATION supabase_realtime ADD TABLE skills;
ALTER PUBLICATION supabase_realtime ADD TABLE artist_skills;

-- Producers can now edit artist rows (previously admin-only). Self-edit and
-- admin-manage policies remain.
CREATE POLICY "Producers can update artists" ON artists
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'producer'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'producer'::app_role));
