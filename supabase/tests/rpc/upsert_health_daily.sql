-- upsert_health_daily: the monotonic guard that keeps a truncated re-read of an older day
-- from decaying a day that was already recorded whole.
--
-- health-rollup rewrites "yesterday" on every 15-minute pass, but the Analytics API's
-- retention is a ROLLING 24 hours: a pass late on day N+1 can only see the tail of day N.
-- A plain overwrite replaced a complete day with that sliver and shrank it further every
-- pass (observed in production before this guard existed).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":288,"failures":3,"rejected":0,"worst_status":500,"p95_ms":900}]'::jsonb);
SELECT is((SELECT runs FROM health_daily WHERE day='2000-01-01' AND fn='t'), 288, 'first write lands');

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":12,"failures":0,"rejected":0,"worst_status":200,"p95_ms":100}]'::jsonb);
SELECT is((SELECT runs FROM health_daily WHERE day='2000-01-01' AND fn='t'), 288, 'a truncated re-read does not shrink the day');
SELECT is((SELECT failures FROM health_daily WHERE day='2000-01-01' AND fn='t'), 3, 'the whole row is preserved, not just runs');

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":300,"failures":4,"rejected":1,"worst_status":502,"p95_ms":950}]'::jsonb);
SELECT is((SELECT runs FROM health_daily WHERE day='2000-01-01' AND fn='t'), 300, 'a fuller read still updates the day');

-- The recompute-and-overwrite design depends on this: a pg_cron double-fire must be a no-op.
SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":300,"failures":4,"rejected":1,"worst_status":502,"p95_ms":950}]'::jsonb);
SELECT is((SELECT failures FROM health_daily WHERE day='2000-01-01' AND fn='t'), 4, 'identical re-run is idempotent');

SELECT * FROM finish();
ROLLBACK;
