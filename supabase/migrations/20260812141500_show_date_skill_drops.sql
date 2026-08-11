-- Per-date skill drops (offers cockpit design 1e, Plan C phase C0).
-- A row means "this show_date does NOT require skill_id, even if the parent show
-- does." The eligibility union becomes (show ∪ dateAdded) \ dateDropped; dropping a
-- non-required skill is inert. Mirrors the show_date_required_skills block in
-- 20260715130000_configurable_eligibility.sql exactly for the RLS/org template:
-- org derivation, same-org guard, uniform org-isolation, realtime.

CREATE TABLE public.show_date_skill_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_date_id, skill_id)
);

-- org_id derivation: BEFORE INSERT, server-derived from the FK parent. Reuses the
-- existing derive function; whatever the client sends is overwritten.
DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_date_skill_drops;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.show_date_skill_drops
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_show_date_id();

-- Same-org guard: a dropped skill must belong to the same org as its date.
-- BEFORE INSERT triggers fire in name order: trg_derive_org_id runs before
-- trg_skill_drop_same_org ('d' < 's'), so NEW.org_id is already derived here.
CREATE OR REPLACE FUNCTION public.check_show_date_skill_drop_same_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_skill_org uuid;
BEGIN
  SELECT org_id INTO v_skill_org FROM public.skills WHERE id = NEW.skill_id;
  IF v_skill_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'dropped skill must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skill_drop_same_org ON public.show_date_skill_drops;
CREATE TRIGGER trg_skill_drop_same_org BEFORE INSERT OR UPDATE ON public.show_date_skill_drops
  FOR EACH ROW EXECUTE FUNCTION public.check_show_date_skill_drop_same_org();

-- RLS: uniform org-isolation template (see migration 20260603120200).
ALTER TABLE public.show_date_skill_drops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view show date skill drops"
  ON public.show_date_skill_drops FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage show date skill drops"
  ON public.show_date_skill_drops FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

-- RESTRICTIVE cross-org isolation, same body as 20260603120200_org_isolation_rls.sql.
-- Plain is_org_member on USING + WITH CHECK, NO active-org write conjunct (#216).
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.show_date_skill_drops';
  EXECUTE 'CREATE POLICY org_isolation ON public.show_date_skill_drops AS RESTRICTIVE FOR ALL TO authenticated '
    || 'USING (public.is_org_member(auth.uid(), org_id)) '
    || 'WITH CHECK (public.is_org_member(auth.uid(), org_id))';
END $$;

-- Realtime so a drop propagates to open cockpits. Guarded so a double-apply is a
-- no-op. RLS still gates delivery to the drop's own org.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'show_date_skill_drops'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.show_date_skill_drops;
  END IF;
END $$;
