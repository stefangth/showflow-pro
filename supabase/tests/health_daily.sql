BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

SELECT has_table('public', 'health_daily', 'health_daily exists');
SELECT col_is_pk('public', 'health_daily', ARRAY['day','fn'], 'PK is (day, fn)');
SELECT has_column('public', 'health_daily', 'unauthorized', 'health_daily has the unauthorized (401) column');
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
