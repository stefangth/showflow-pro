ALTER TABLE public.notifications DROP CONSTRAINT notifications_null_org_id_platform_only;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_null_org_id_platform_only
  CHECK (org_id IS NOT NULL OR type IN ('cron_health_alert', 'email_health_degraded'));
