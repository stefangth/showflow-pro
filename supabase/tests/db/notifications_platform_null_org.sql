-- The org_id-nullable relaxation (20260623083502) is guarded by a CHECK so that ONLY platform-level
-- cron/email-health notifications may omit org_id. A null-org notification addressed to a non-super-admin
-- would be permanently invisible (the org_isolation RESTRICTIVE policy evaluates is_org_member(uid, NULL) ->
-- UNKNOWN -> the row is hidden, with no error), so the invariant must be machine-enforced.
--
-- CHECK constraints fire regardless of session_replication_role, so we run in replica mode to skip the
-- gate_notification_pref BEFORE-INSERT trigger (which would otherwise swallow rows) and the FK checks
-- (so we needn't seed real users/orgs) — while the CHECK under test still fires.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;

SELECT lives_ok(
  $$ INSERT INTO public.notifications (user_id, org_id, type, title, read)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000000aa', 'booking_offer', 't', false) $$,
  'org-scoped notification (org_id set) is allowed'
);

SELECT lives_ok(
  $$ INSERT INTO public.notifications (user_id, org_id, type, title, read)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', NULL, 'cron_health_alert', 't', false) $$,
  'platform cron notification (org_id null, cron_ type) is allowed'
);

SELECT lives_ok(
  $$ INSERT INTO public.notifications (user_id, org_id, type, title, read)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', NULL, 'email_health_degraded', 't', false) $$,
  'platform email-health-degraded notification (org_id null) is allowed'
);

SELECT throws_ok(
  $$ INSERT INTO public.notifications (user_id, org_id, type, title, read)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', NULL, 'booking_offer', 't', false) $$,
  '23514',
  NULL,
  'null-org non-cron notification violates the platform-only CHECK'
);

-- The guard is an exact-value list, not a 'cron_%' prefix: a cron_-prefixed but non-allowlisted type
-- must still be rejected when org_id is null (else it would be permanently invisible to its recipient).
SELECT throws_ok(
  $$ INSERT INTO public.notifications (user_id, org_id, type, title, read)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', NULL, 'cron_offboarding', 't', false) $$,
  '23514',
  NULL,
  'null-org cron_-prefixed-but-unlisted notification still violates the platform-only CHECK'
);

SET session_replication_role = origin;
SELECT * FROM finish();
ROLLBACK;
