-- Configurable eligibility (booking flow phase 4), spec:
-- docs/superpowers/specs/2026-07-15-configurable-eligibility-design.md
-- 1) Show-scoped cast priorities: nullable priority on show_cast_eligibility.
--    priority IS NULL keeps the row's existing meaning (eligible, untiered).
-- 2) Uniform required skills per show and per date (union semantics).
-- 3) Guards: org derivation (client org_id is overwritten) and same-org skill check.

ALTER TABLE public.show_cast_eligibility
  ADD COLUMN priority integer CHECK (priority >= 1);

-- One cast per tier per (show, city), mirroring cast_city_priority's UNIQUE (city_id, priority).
CREATE UNIQUE INDEX show_cast_eligibility_show_city_priority_uniq
  ON public.show_cast_eligibility (show_id, city_id, priority)
  WHERE priority IS NOT NULL;

CREATE TABLE public.show_required_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_id, skill_id)
);

CREATE TABLE public.show_date_required_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_date_id, skill_id)
);

-- org_id derivation: BEFORE INSERT, server-derived from the FK parent. Reuses the
-- existing derive functions; whatever the client sends is overwritten.
DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_required_skills;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_show_id();

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_date_required_skills;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_date_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_show_date_id();

-- Same-org guard: a required skill must belong to the same org as its show/date.
-- BEFORE INSERT triggers fire in name order: trg_derive_org_id runs before
-- trg_required_skill_same_org ('d' < 'r'), so NEW.org_id is already derived here.
CREATE OR REPLACE FUNCTION public.check_required_skill_same_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_skill_org uuid;
BEGIN
  SELECT org_id INTO v_skill_org FROM public.skills WHERE id = NEW.skill_id;
  IF v_skill_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'required skill must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_required_skill_same_org ON public.show_required_skills;
CREATE TRIGGER trg_required_skill_same_org BEFORE INSERT OR UPDATE ON public.show_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.check_required_skill_same_org();

DROP TRIGGER IF EXISTS trg_required_skill_same_org ON public.show_date_required_skills;
CREATE TRIGGER trg_required_skill_same_org BEFORE INSERT OR UPDATE ON public.show_date_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.check_required_skill_same_org();

-- RLS: uniform org-isolation template (see migration 20260603120200).
ALTER TABLE public.show_required_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.show_date_required_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view show required skills"
  ON public.show_required_skills FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show required skills"
  ON public.show_required_skills FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

CREATE POLICY "Org members can view show date required skills"
  ON public.show_date_required_skills FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show date required skills"
  ON public.show_date_required_skills FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

-- RESTRICTIVE cross-org isolation, same body as 20260603120200_org_isolation_rls.sql.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['show_required_skills','show_date_required_skills'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (public.is_org_member(auth.uid(), org_id)) '
      || 'WITH CHECK (public.is_org_member(auth.uid(), org_id))',
      t);
  END LOOP;
END $$;
