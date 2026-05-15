INSERT INTO public.app_settings (key, value, description)
SELECT 'cron_secret', to_jsonb(encode(gen_random_bytes(32), 'hex')), 'Shared secret for pg_cron → edge function authentication'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'cron_secret');
