-- Named production slots (Plan B, task 1 of 2026-08-11-production-slots).
-- Foundation tables only: show_slots (role rows: name/count/kind) and
-- show_slot_required_skills (per-slot required skills). A later migration adds
-- the recompute trigger that keeps shows.main_cast_slots/understudy_slots and
-- show_required_skills as maintained caches derived from these rows; this
-- migration is purely additive and does not touch that engine.
--
-- Conventions mirrored verbatim from 20260715130000_configurable_eligibility.sql:
-- org_id derivation via a BEFORE INSERT trigger, a same-org guard trigger for the
-- second FK (skill_id), RLS (SELECT = is_org_member, ALL = admin/producer via
-- has_org_role), and the RESTRICTIVE org_isolation policy in its plain
-- is_org_member form (matches the most recent precedent, org_member_removals,
-- 20260811103008 -- new tables are not part of the active-org-scoped retrofit
-- list in 20260806104215/20260807104500).

CREATE TABLE public.show_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  name text NOT NULL,
  slot_count smallint NOT NULL CHECK (slot_count >= 0),
  kind text NOT NULL CHECK (kind IN ('main','understudy')),
  sort_order smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.show_slot_required_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.show_slots(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, skill_id)
);

-- org_id derivation: BEFORE INSERT, server-derived from the FK parent. Whatever
-- the client sends is overwritten (see 20260604130000_org_id_derivation_triggers.sql
-- for the general pattern this follows).
CREATE OR REPLACE FUNCTION public.derive_org_id_for_show_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT org_id INTO NEW.org_id FROM public.shows WHERE id = NEW.show_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_slots;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_slots
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_show_slot();

CREATE OR REPLACE FUNCTION public.derive_org_id_for_show_slot_skill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT org_id INTO NEW.org_id FROM public.show_slots WHERE id = NEW.slot_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_slot_required_skills;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_slot_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_show_slot_skill();

-- Same-org guard: a required skill must belong to the same org as its slot.
-- BEFORE INSERT triggers fire in name order: trg_derive_org_id runs before
-- trg_show_slot_skill_same_org ('d' < 's'), so NEW.org_id is already derived here.
CREATE OR REPLACE FUNCTION public.check_show_slot_skill_same_org()
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

DROP TRIGGER IF EXISTS trg_show_slot_skill_same_org ON public.show_slot_required_skills;
CREATE TRIGGER trg_show_slot_skill_same_org BEFORE INSERT OR UPDATE ON public.show_slot_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.check_show_slot_skill_same_org();

-- updated_at maintenance (show_slot_required_skills has no updated_at column).
DROP TRIGGER IF EXISTS update_show_slots_updated_at ON public.show_slots;
CREATE TRIGGER update_show_slots_updated_at BEFORE UPDATE ON public.show_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: uniform org-isolation template (see migration 20260603120200).
ALTER TABLE public.show_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.show_slot_required_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view show slots"
  ON public.show_slots FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show slots"
  ON public.show_slots FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

CREATE POLICY "Org members can view show slot required skills"
  ON public.show_slot_required_skills FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show slot required skills"
  ON public.show_slot_required_skills FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

-- RESTRICTIVE cross-org isolation, same body as 20260603120200_org_isolation_rls.sql.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['show_slots','show_slot_required_skills'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING (public.is_org_member(auth.uid(), org_id)) '
      || 'WITH CHECK (public.is_org_member(auth.uid(), org_id))',
      t);
  END LOOP;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.show_slots;
ALTER PUBLICATION supabase_realtime ADD TABLE public.show_slot_required_skills;
