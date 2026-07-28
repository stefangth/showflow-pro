-- Every HTTP-dispatching cron job must fire on its own minute. When several collide (they all
-- landed on :00 before 2026-07-28) the edge runtime serializes the simultaneous cold boots at
-- roughly 10s each, the later ones cross pg_net's timeout, and healthy 200 runs get recorded as
-- false `timed_out` responses that cron-health-watcher reports as failures. Regression guard for
-- the cron_stagger_and_timeout migration. See memory cron-health-watcher-false-timeouts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- EXISTS(...) rather than a set-returning assertion over a WHERE clause: a missing job row would
-- otherwise return zero rows and be silently SKIPPED, desyncing plan(8) instead of failing.
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='expire-offers-hourly' AND schedule='0 * * * *'),
          'expire-offers-hourly fires at :00');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='airtable-poll' AND schedule='2-59/5 * * * *'),
          'airtable-poll fires at :02 and every 5 min after, never :00');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='offer-digest' AND schedule='3 16-19 * * *'),
          'offer-digest fires at :03 (hour field unchanged, Berlin gate unaffected)');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='confirmation-digest' AND schedule='4 17-20 * * *'),
          'confirmation-digest fires at :04 (hour field unchanged)');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='tier-at-risk-hourly' AND schedule='5 * * * *'),
          'tier-at-risk-hourly fires at :05');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='cron-health-watcher' AND schedule='9-59/15 * * * *'),
          'cron-health-watcher fires at :09/:24/:39/:54');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='email-health-watcher' AND schedule='11-59/15 * * * *'),
          'email-health-watcher fires at :11/:26/:41/:56');

-- Aggregate guard: all seven dispatch jobs must have distinct minute fields. Catches a future
-- edit that reintroduces a collision without touching the per-job assertions above.
SELECT is(
  (SELECT count(DISTINCT split_part(schedule, ' ', 1))::int FROM cron.job
   WHERE jobname IN ('offer-digest','confirmation-digest','expire-offers-hourly',
                     'tier-at-risk-hourly','airtable-poll','cron-health-watcher','email-health-watcher')),
  7,
  'no two dispatch jobs share a minute field'
);

SELECT * FROM finish();
ROLLBACK;
