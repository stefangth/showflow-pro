-- Phase 4 (wireflow v3): per-(cast x production) fee. Inherits the org OrderDefaultsCard
-- defaults; generate-hire-orders resolves this over the org default (below the booking/manual fee).

CREATE TABLE public.cast_production_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cast_id uuid NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  fee_amount numeric,
  currency text NOT NULL DEFAULT 'EUR',
  fee_basis text NOT NULL DEFAULT 'per_date',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cast_id, show_id)
);

-- org_id derivation: BEFORE INSERT, from show_id (a fee's org is its production's org),
-- with a cross-org guard: org_isolation only checks membership on the derived org_id, not
-- that cast_id belongs to the same org, so this bespoke fn (not the generic
-- derive_org_id_from_show_id) validates cast_id/show_id are same-org before deriving.
CREATE OR REPLACE FUNCTION public.derive_org_id_for_cast_production_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_show_org uuid; v_cast_org uuid;
BEGIN
  SELECT org_id INTO v_show_org FROM public.shows WHERE id = NEW.show_id;
  SELECT org_id INTO v_cast_org FROM public.casts WHERE id = NEW.cast_id;
  IF v_show_org IS NULL THEN RAISE EXCEPTION 'show % not found', NEW.show_id; END IF;
  IF v_cast_org IS DISTINCT FROM v_show_org THEN
    RAISE EXCEPTION 'cast and production belong to different orgs'; END IF;
  NEW.org_id := v_show_org;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.cast_production_fees;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.cast_production_fees
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_cast_production_fee();

CREATE TRIGGER update_cast_production_fees_updated_at
  BEFORE UPDATE ON public.cast_production_fees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cast_production_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view cast production fees"
  ON public.cast_production_fees FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage cast production fees"
  ON public.cast_production_fees FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

-- RESTRICTIVE cross-org isolation, same body as 20260603120200_org_isolation_rls.sql.
-- Plain is_org_member on USING + WITH CHECK, NO active-org write conjunct (#216).
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.cast_production_fees';
  EXECUTE 'CREATE POLICY org_isolation ON public.cast_production_fees AS RESTRICTIVE FOR ALL TO authenticated '
    || 'USING (public.is_org_member(auth.uid(), org_id)) '
    || 'WITH CHECK (public.is_org_member(auth.uid(), org_id))';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cast_production_fees'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cast_production_fees';
  END IF;
END $$;
