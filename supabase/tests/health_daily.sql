BEGIN;
SELECT plan(6);

SELECT has_table('public', 'health_daily', 'health_daily exists');
SELECT col_is_pk('public', 'health_daily', ARRAY['day','fn'], 'PK is (day, fn)');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.health_daily'::regclass),
  'RLS is enabled on health_daily'
);
-- No write policy: the rollup writes with the service role, which bypasses RLS.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'health_daily' AND cmd <> 'SELECT'),
  0, 'health_daily has no INSERT/UPDATE/DELETE policy'
);
SELECT has_function('public', 'get_health_daily', ARRAY['integer'], 'get_health_daily(int) exists');
SELECT is(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_health_daily'),
  true, 'get_health_daily is SECURITY DEFINER'
);

SELECT * FROM finish();
ROLLBACK;

-- upsert_health_daily: the monotonic guard that keeps a truncated re-read of an older day
-- (Analytics retention is a rolling 24h) from decaying a day that was already recorded whole.
BEGIN;
SELECT plan(5);

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":288,"failures":3,"rejected":0,"worst_status":500,"p95_ms":900}]'::jsonb);
SELECT is((SELECT runs FROM health_daily WHERE day='2000-01-01' AND fn='t'), 288, 'first write lands');

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":12,"failures":0,"rejected":0,"worst_status":200,"p95_ms":100}]'::jsonb);
SELECT is((SELECT runs FROM health_daily WHERE day='2000-01-01' AND fn='t'), 288, 'a truncated re-read does not shrink the day');
SELECT is((SELECT failures FROM health_daily WHERE day='2000-01-01' AND fn='t'), 3, 'the whole row is preserved, not just runs');

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":300,"failures":4,"rejected":1,"worst_status":502,"p95_ms":950}]'::jsonb);
SELECT is((SELECT runs FROM health_daily WHERE day='2000-01-01' AND fn='t'), 300, 'a fuller read still updates the day');

SELECT upsert_health_daily('[{"day":"2000-01-01","fn":"t","runs":300,"failures":4,"rejected":1,"worst_status":502,"p95_ms":950}]'::jsonb);
SELECT is((SELECT failures FROM health_daily WHERE day='2000-01-01' AND fn='t'), 4, 'identical re-run is idempotent');

SELECT * FROM finish();
ROLLBACK;
