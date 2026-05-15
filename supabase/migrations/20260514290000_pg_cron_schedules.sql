-- Create private schema and helper function for cron secret
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.cron_secret() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT value #>> '{}' FROM public.app_settings WHERE key = 'cron_secret' $$;

-- Remove any legacy cron jobs first (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname IN (
    'expire-soft-bookings', 'expire_soft_bookings',
    'offer-digest', 'confirmation-digest',
    'expire-offers-hourly', 'tier-at-risk-hourly'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Offer digest: runs every hour 16-19 UTC (covers 18-21 Berlin summer / 17-20 winter)
SELECT cron.schedule(
  'offer-digest',
  '0 16-19 * * *',
  $$
    SELECT net.http_post(
      url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-offer-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', private.cron_secret()
      ),
      body := '{}'::jsonb
    )
  $$
);

-- Confirmation digest: runs every hour 17-20 UTC
SELECT cron.schedule(
  'confirmation-digest',
  '0 17-20 * * *',
  $$
    SELECT net.http_post(
      url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/send-confirmation-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', private.cron_secret()
      ),
      body := '{}'::jsonb
    )
  $$
);

-- Expire offers: every hour on the hour
SELECT cron.schedule(
  'expire-offers-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/expire-offers',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', private.cron_secret()
      ),
      body := '{}'::jsonb
    )
  $$
);

-- Tier at risk: every hour at :05
SELECT cron.schedule(
  'tier-at-risk-hourly',
  '5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/tier-at-risk-watcher',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', private.cron_secret()
      ),
      body := '{}'::jsonb
    )
  $$
);
