-- prune_email_log: deletes email_send_log rows older than email_log_retention_days
-- (app_settings, org_id IS NULL; default 90 — see 20260710231816_email_delivery_tables.sql).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(1);

INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at)
VALUES (gen_random_uuid(), 'offer_digest', 'old@t.test', 'delivered', now() - interval '120 days');
SELECT public.prune_email_log();
SELECT is((SELECT count(*)::int FROM public.email_send_log WHERE recipient_email = 'old@t.test'), 0,
  'prune_email_log deletes rows older than retention');

SELECT * FROM finish();
ROLLBACK;
