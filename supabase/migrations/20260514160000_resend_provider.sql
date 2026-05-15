-- Seed Resend email provider settings
-- resend_from_address: the From: header used for all transactional emails.
-- Must match a domain verified in the Resend dashboard.
INSERT INTO public.app_settings (key, value, description) VALUES
  ('resend_from_address', '"Showflow Pro <noreply@showflow.pro>"'::jsonb,
   'From address for all transactional emails (must be a Resend-verified domain)'),
  ('offer_digest_hour_berlin', '19'::jsonb,
   'Hour (0-23, Europe/Berlin) to send the daily offer digest email'),
  ('confirmation_digest_hour_berlin', '20'::jsonb,
   'Hour (0-23, Europe/Berlin) to send the daily confirmation digest email')
ON CONFLICT (key) DO NOTHING;
