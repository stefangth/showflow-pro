ALTER TABLE public.show_dates
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  entity       text NOT NULL DEFAULT 'show_dates'
                 CHECK (entity IN ('show_dates','artists','shows')),
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  label        text NOT NULL,
  type         text NOT NULL CHECK (type IN ('text','number','date','boolean','select')),
  source       text NOT NULL DEFAULT 'airtable' CHECK (source IN ('airtable')),
  source_field text NOT NULL,
  options      jsonb,
  filterable   boolean NOT NULL DEFAULT true,
  sortable     boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org
  ON public.custom_field_definitions (org_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_entity
  ON public.custom_field_definitions (org_id, entity);

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.custom_field_definitions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can view custom_field_definitions"
  ON public.custom_field_definitions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can manage custom_field_definitions"
  ON public.custom_field_definitions FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'));

CREATE TRIGGER update_custom_field_definitions_updated_at
  BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
