-- Every cron job that dispatches an edge function via net.http_post MUST set an explicit
-- timeout_milliseconds well above pg_net's 5000ms default. Edge-function cold starts run
-- 3-10s (observed in prod), so the 5s default records healthy (200) invocations as false
-- "timed out" responses in net._http_response — which the cron-health-watcher then reports
-- as `failing` and pages super-admins about. Regression guard for the cron_dispatch_timeout
-- migration (raises every dispatch to a 30000ms timeout). See memory cron-health-watcher-false-timeouts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

-- Per-job guards use ok(EXISTS(...)) rather than a set-returning matches() over a WHERE clause:
-- if a job row were ABSENT, a `SELECT matches(...) FROM cron.job WHERE jobname='x'` returns zero
-- rows and the assertion is silently SKIPPED (desyncing plan(7)), instead of failing. EXISTS makes
-- a missing job an explicit failure.
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'airtable-poll' AND command ~ 'timeout_milliseconds\s*:=\s*30000'),
  'airtable-poll dispatch sets a 30s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'offer-digest' AND command ~ 'timeout_milliseconds\s*:=\s*30000'),
  'offer-digest dispatch sets a 30s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'confirmation-digest' AND command ~ 'timeout_milliseconds\s*:=\s*30000'),
  'confirmation-digest dispatch sets a 30s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'expire-offers-hourly' AND command ~ 'timeout_milliseconds\s*:=\s*30000'),
  'expire-offers-hourly dispatch sets a 30s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'tier-at-risk-hourly' AND command ~ 'timeout_milliseconds\s*:=\s*30000'),
  'tier-at-risk-hourly dispatch sets a 30s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'cron-health-watcher' AND command ~ 'timeout_milliseconds\s*:=\s*30000'),
  'cron-health-watcher dispatch sets a 30s timeout'
);

-- Aggregate guard: none of the six dispatch jobs may fall back to the implicit 5000ms default.
SELECT is(
  (SELECT count(*)::int FROM cron.job
   WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                     'tier-at-risk-hourly','airtable-poll','cron-health-watcher')
     AND command !~ 'timeout_milliseconds'),
  0,
  'no dispatch job relies on the implicit 5000ms pg_net default'
);

SELECT * FROM finish();
ROLLBACK;
