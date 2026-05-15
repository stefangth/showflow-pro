-- show_assignments: maps producer users to show scopes for notification routing.
-- Resolution priority (most specific wins):
--   1. (program, sub_program, city)
--   2. (program, city)
--   3. (program, sub_program)
--   4. (program only)
--   5. Admins as fallback (handled in application code)
CREATE TABLE public.show_assignments (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  producer_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program           TEXT        NOT NULL,
  sub_program       TEXT,
  city_id           UUID        REFERENCES public.cities(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT show_assignments_unique
    UNIQUE NULLS NOT DISTINCT (producer_user_id, program, sub_program, city_id)
);

ALTER TABLE public.show_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and producers can manage show_assignments"
ON public.show_assignments FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.show_assignments;

-- Resolve the most specific producer assignment for a (program, sub_program, city) tuple.
-- Returns NULL when no match; caller should fall back to admins.
CREATE OR REPLACE FUNCTION public.resolve_show_assignments(
  p_program     TEXT,
  p_sub_program TEXT,
  p_city_id     UUID
)
RETURNS TABLE(producer_user_id UUID, specificity INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT producer_user_id,
         CASE
           WHEN sub_program = p_sub_program AND city_id = p_city_id THEN 4
           WHEN city_id     = p_city_id     AND sub_program IS NULL  THEN 3
           WHEN sub_program = p_sub_program AND city_id IS NULL      THEN 2
           WHEN city_id IS NULL AND sub_program IS NULL              THEN 1
           ELSE 0
         END AS specificity
  FROM show_assignments
  WHERE program = p_program
    AND (sub_program = p_sub_program OR sub_program IS NULL)
    AND (city_id     = p_city_id     OR city_id IS NULL)
    AND CASE
          WHEN sub_program = p_sub_program AND city_id = p_city_id THEN 4
          WHEN city_id     = p_city_id     AND sub_program IS NULL  THEN 3
          WHEN sub_program = p_sub_program AND city_id IS NULL      THEN 2
          WHEN city_id IS NULL AND sub_program IS NULL              THEN 1
          ELSE 0
        END > 0
  ORDER BY specificity DESC;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_show_assignments(TEXT, TEXT, UUID)
  TO authenticated;
