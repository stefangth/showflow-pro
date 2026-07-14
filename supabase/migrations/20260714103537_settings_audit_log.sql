-- settings_audit_log: per-change audit for app_settings, feeding the
-- Settings → Booking flow "Change history" rail.
-- Writes happen ONLY via the trigger below (SECURITY DEFINER); there is
-- deliberately no INSERT policy (no WITH CHECK (true) on audit tables).
-- Rows with org_id IS NULL (platform-default edits) are invisible to org
-- members by design; a platform-console reader can be added later.

CREATE TABLE public.settings_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  actor uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_settings_audit_org_key
  ON public.settings_audit_log (org_id, key, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_app_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.settings_audit_log (org_id, key, actor, old_value, new_value)
  VALUES (
    NEW.org_id,
    NEW.key,
    auth.uid(),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END,
    NEW.value
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_app_settings_change
AFTER INSERT OR UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.log_app_settings_change();

ALTER TABLE public.settings_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.settings_audit_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can view settings audit"
  ON public.settings_audit_log FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'));
