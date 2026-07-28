-- Every cron job that dispatches an edge function via net.http_post MUST set an explicit
-- timeout_milliseconds above the real tail latency of an edge invocation. pg_net's implicit
-- default is 5000ms; a 30000ms ceiling was still under the observed tail (200 responses at
-- 33.3s, 34.9s, 43.6s and 44.2s on 2026-07-28), and every run that crosses the ceiling is
-- recorded as a false `timed_out` that cron-health-watcher reports as `failing` and pages
-- super-admins about. 90s covers a serialized cold boot plus real work while still catching a
-- genuinely hung function. Regression guard for the cron_stagger_and_timeout migration.
-- See memory cron-health-watcher-false-timeouts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- Per-job guards use ok(EXISTS(...)) rather than a set-returning matches() over a WHERE clause:
-- if a job row were ABSENT, a `SELECT matches(...) FROM cron.job WHERE jobname='x'` returns zero
-- rows and the assertion is silently SKIPPED (desyncing plan(8)), instead of failing. EXISTS makes
-- a missing job an explicit failure.
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'airtable-poll' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'airtable-poll dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'offer-digest' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'offer-digest dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'confirmation-digest' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'confirmation-digest dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'expire-offers-hourly' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'expire-offers-hourly dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'tier-at-risk-hourly' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'tier-at-risk-hourly dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'cron-health-watcher' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'cron-health-watcher dispatch sets a 90s timeout'
);
SELECT ok(
  EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'email-health-watcher' AND command ~ 'timeout_milliseconds\s*:=\s*90000'),
  'email-health-watcher dispatch sets a 90s timeout'
);

-- Aggregate guard: none of the seven dispatch jobs may fall back to the implicit 5000ms default.
SELECT is(
  (SELECT count(*)::int FROM cron.job
   WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                     'tier-at-risk-hourly','airtable-poll','cron-health-watcher','email-health-watcher')
     AND command !~ 'timeout_milliseconds'),
  0,
  'no dispatch job relies on the implicit 5000ms pg_net default'
);

SELECT * FROM finish();
ROLLBACK;
