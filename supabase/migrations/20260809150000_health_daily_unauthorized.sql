-- Add a precise 401 (unauthorized) bucket to the durable health rollup so the System Health
-- uptime bar can exclude unauthorized traffic EXACTLY, replacing the frontend-only
-- worst_status===401 heuristic (which masked a same-day 400 mixed with 401s). 401 = the auth
-- layer correctly rejecting an unauthenticated caller, not the function failing.
--
-- `rejected` keeps its meaning (all 4xx) for backward compatibility; `unauthorized` is the 401
-- subset. health-rollup writes it; get_health_daily returns it; uptime.classify() then uses
-- (rejected - unauthorized) / runs. See docs/superpowers/specs/2026-08-09-cron-401-degraded-design.md (B1).

alter table public.health_daily
  add column if not exists unauthorized int not null default 0;

-- get_health_daily gains the column. RETURNS TABLE is part of the function signature, so a plain
-- CREATE OR REPLACE cannot add a column ("cannot change return type of existing function") --
-- drop then recreate. Grants and body are otherwise identical to 20260804180545_health_daily.sql.
drop function if exists public.get_health_daily(int);
create function public.get_health_daily(p_days int)
returns table (
  day date, fn text, runs int, failures int, rejected int, unauthorized int, worst_status int, p95_ms int
)
language sql stable security definer set search_path = public as $$
  select h.day, h.fn, h.runs, h.failures, h.rejected, h.unauthorized, h.worst_status, h.p95_ms
  from public.health_daily h
  where is_super_admin(auth.uid())
    and h.day > (current_date - least(greatest(coalesce(p_days, 30), 1), 90))
  order by h.fn, h.day;
$$;
revoke all on function public.get_health_daily(int) from public, anon;
grant execute on function public.get_health_daily(int) to authenticated;

-- Teach the writer about the new column, or health-rollup's unauthorized count is silently
-- dropped. Body is identical to 20260804184302_health_daily_monotonic_upsert.sql (same monotonic
-- runs >= h.runs guard) plus the unauthorized column in the INSERT list, the SELECT, and the
-- ON CONFLICT SET. Signature (jsonb -> int) is unchanged, so generated types do not move.
CREATE OR REPLACE FUNCTION public.upsert_health_daily(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected int;
BEGIN
  INSERT INTO public.health_daily AS h (day, fn, runs, failures, rejected, unauthorized, worst_status, p95_ms, updated_at)
  SELECT (r->>'day')::date,
         r->>'fn',
         COALESCE((r->>'runs')::int, 0),
         COALESCE((r->>'failures')::int, 0),
         COALESCE((r->>'rejected')::int, 0),
         COALESCE((r->>'unauthorized')::int, 0),
         (r->>'worst_status')::int,
         (r->>'p95_ms')::int,
         now()
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
  ON CONFLICT (day, fn) DO UPDATE
    SET runs = EXCLUDED.runs,
        failures = EXCLUDED.failures,
        rejected = EXCLUDED.rejected,
        unauthorized = EXCLUDED.unauthorized,
        worst_status = EXCLUDED.worst_status,
        p95_ms = EXCLUDED.p95_ms,
        updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.runs >= h.runs;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_health_daily(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_health_daily(jsonb) TO service_role;

-- One-time historical backfill: rows whose only badness is 401 (no 5xx, worst 4xx = 401) get their
-- rejected count attributed to unauthorized, so the already-recorded amber cron-function cells on the
-- 30-day bar flip to operational immediately. Days older than ~2 cannot be recomputed by health-rollup
-- (Analytics retains only 24h), so this is the only way to reconcile them. Safe: the affected cron
-- endpoints only ever receive 401 as their 4xx, so unauthorized = rejected is exact for them.
update public.health_daily
   set unauthorized = rejected
 where failures = 0 and worst_status = 401 and unauthorized = 0;
