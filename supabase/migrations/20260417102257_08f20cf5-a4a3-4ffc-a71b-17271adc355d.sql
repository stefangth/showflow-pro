
-- App settings table for admin-managed configuration
CREATE TABLE public.app_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read settings (e.g., to know if features are on)
CREATE POLICY "Authenticated users can view app settings"
ON public.app_settings FOR SELECT
TO authenticated
USING (true);

-- Only admins can insert
CREATE POLICY "Admins can insert app settings"
ON public.app_settings FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update
CREATE POLICY "Admins can update app settings"
ON public.app_settings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete
CREATE POLICY "Admins can delete app settings"
ON public.app_settings FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Reuse existing timestamp trigger
CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default settings
INSERT INTO public.app_settings (key, value, description) VALUES
  ('airtable_sync_enabled', 'false'::jsonb, 'Enable Airtable polling sync (currently mocked)'),
  ('airtable_poll_interval_minutes', '5'::jsonb, 'How often (in minutes) to poll Airtable for changes'),
  ('airtable_base_id', '""'::jsonb, 'Airtable base ID to sync from'),
  ('airtable_table_name', '"Shows"'::jsonb, 'Airtable table name to sync from'),
  ('soft_book_expiry_hours', '48'::jsonb, 'Hours before a soft-booked slot auto-expires'),
  ('max_suggestions', '5'::jsonb, 'Maximum auto-suggested artists shown per slot'),
  ('auto_suggest_enabled', 'true'::jsonb, 'Enable the auto-suggest booking engine'),
  ('notifications_enabled', 'true'::jsonb, 'Enable in-app notifications');
