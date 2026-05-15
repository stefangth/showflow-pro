-- Airtable poll: every 5 minutes
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'airtable-poll';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'airtable-poll',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/airtable-poll',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', private.cron_secret()
      ),
      body := '{}'::jsonb
    )
  $$
);
