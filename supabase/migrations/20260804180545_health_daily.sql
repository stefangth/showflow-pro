-- Durable daily health rollup. The Supabase Analytics API retains 24 hours, so the System
-- Health console's 30-day uptime bar cannot be derived from it. health-rollup recomputes
-- today and yesterday from Analytics every 15 minutes and upserts here; recomputing (rather
-- than incrementing) keeps the writer idempotent, and covering yesterday closes the gap at
-- the midnight boundary.
--
-- Keyed by deployed function slug, not by cron job name: scheduled jobs ARE edge functions,
-- so one rollup feeds both panels and the two can never disagree.
CREATE TABLE public.health_daily (
  day          date        NOT NULL,
  fn           text        NOT NULL,
  runs         int         NOT NULL DEFAULT 0,
  failures     int         NOT NULL DEFAULT 0,
  rejected     int         NOT NULL DEFAULT 0,
  worst_status int,
  p95_ms       int,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, fn)
);
CREATE INDEX health_daily_day_idx ON public.health_daily (day DESC);

ALTER TABLE public.health_daily ENABLE ROW LEVEL SECURITY;

-- Read-only for super-admins. Writes come from the service-role rollup, which bypasses RLS --
-- deliberately NO write policy (mirrors cron_health_log; never add WITH CHECK (true) here).
CREATE POLICY "super-admin reads health_daily" ON public.health_daily
  FOR SELECT USING (is_super_admin(auth.uid()));

-- Dashboard feed. Bounded server-side so a client cannot ask for an unbounded scan.
CREATE OR REPLACE FUNCTION public.get_health_daily(p_days int)
RETURNS TABLE (
  day date, fn text, runs int, failures int, rejected int, worst_status int, p95_ms int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.day, h.fn, h.runs, h.failures, h.rejected, h.worst_status, h.p95_ms
  FROM public.health_daily h
  WHERE is_super_admin(auth.uid())
    AND h.day > (CURRENT_DATE - LEAST(GREATEST(COALESCE(p_days, 30), 1), 90))
  ORDER BY h.fn, h.day;
$$;
REVOKE ALL ON FUNCTION public.get_health_daily(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_health_daily(int) TO authenticated;
