-- health-rollup recomputes whole days and overwrites them, which is what makes it idempotent
-- under a pg_cron double-fire. But the Analytics API's retention is a ROLLING 24 hours, so a
-- pass late on day N+1 can only see the tail of day N: re-reading "yesterday" at 18:00 returns
-- roughly six hours of it, and a plain overwrite would replace a complete day with that sliver,
-- decaying it further every 15 minutes until the day scrolled out of range.
--
-- Fix the invariant at the write instead of trying to time the reads: a day's counts only ever
-- grow while it is being observed, so an update that would REDUCE runs is a truncated read and
-- must be ignored. Comparing on runs (not per column) keeps each row internally consistent --
-- runs/failures/rejected/p95 always come from the same observation.
--
-- Still idempotent: re-running the same pass writes identical values (runs = runs passes the
-- >= test and rewrites the same numbers).
CREATE OR REPLACE FUNCTION public.upsert_health_daily(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected int;
BEGIN
  INSERT INTO public.health_daily AS h (day, fn, runs, failures, rejected, worst_status, p95_ms, updated_at)
  SELECT (r->>'day')::date,
         r->>'fn',
         COALESCE((r->>'runs')::int, 0),
         COALESCE((r->>'failures')::int, 0),
         COALESCE((r->>'rejected')::int, 0),
         (r->>'worst_status')::int,
         (r->>'p95_ms')::int,
         now()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
  ON CONFLICT (day, fn) DO UPDATE
    SET runs = EXCLUDED.runs,
        failures = EXCLUDED.failures,
        rejected = EXCLUDED.rejected,
        worst_status = EXCLUDED.worst_status,
        p95_ms = EXCLUDED.p95_ms,
        updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.runs >= h.runs;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Writer is the service-role rollup only; no authenticated caller has any business writing here.
REVOKE ALL ON FUNCTION public.upsert_health_daily(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_health_daily(jsonb) TO service_role;
