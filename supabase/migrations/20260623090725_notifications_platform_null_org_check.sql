-- Guard the org_id-nullable relaxation (20260623083502): only platform-level cron notifications may
-- omit org_id. A null-org notification addressed to a non-super-admin would be permanently invisible
-- (the org_isolation RESTRICTIVE policy evaluates is_org_member(uid, NULL) -> UNKNOWN -> the row is
-- hidden, with no error). This CHECK makes that invariant machine-enforced. All existing rows have a
-- non-null org_id (verified: 0 null-org rows), so the constraint validates without rewrite.
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_null_org_id_platform_only
  CHECK (org_id IS NOT NULL OR type LIKE 'cron_%');
