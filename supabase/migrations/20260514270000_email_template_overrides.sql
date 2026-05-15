INSERT INTO public.app_settings (key, value, description) VALUES
  ('email_template_overrides', '{}'::jsonb,
   'Per-template overrides. Keys are template names; values: { subject, intro, cta_label, footer } — null fields use hardcoded defaults.')
ON CONFLICT (key) DO NOTHING;
