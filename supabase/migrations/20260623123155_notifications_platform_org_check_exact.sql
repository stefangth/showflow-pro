-- Review follow-up: tighten the platform-null-org guard (was `type LIKE 'cron_%'` in 20260623090725).
-- A prefix match would also permit a future org-scoped type that merely starts with 'cron_' (e.g.
-- cron_offboarding) to carry org_id = null, making it permanently invisible to its non-super-admin
-- recipient (org_isolation RESTRICTIVE policy: is_org_member(uid, NULL) -> UNKNOWN -> row hidden).
-- Restrict to the exact known platform type(s); add new ones explicitly as they are introduced.
-- Verified 0 null-org rows exist, so the re-add validates without rewrite.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_null_org_id_platform_only;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_null_org_id_platform_only
  CHECK (org_id IS NOT NULL OR type IN ('cron_health_alert'));
