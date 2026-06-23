-- Cron-health monitoring: dispatch log (request_id <-> job), current per-job state, 30-day failure log.
CREATE TABLE public.cron_health_dispatch (
  id            bigserial PRIMARY KEY,
  job_name      text        NOT NULL,
  request_id    bigint      NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cron_health_dispatch_request_idx ON public.cron_health_dispatch (request_id);
CREATE INDEX cron_health_dispatch_job_time_idx ON public.cron_health_dispatch (job_name, dispatched_at DESC);

CREATE TABLE public.cron_health_state (
  job_name             text PRIMARY KEY,
  last_dispatched_at   timestamptz,
  last_response_at     timestamptz,
  last_status_code     int,
  last_ok_at           timestamptz,
  last_error           text,
  status               text NOT NULL DEFAULT 'unknown'
                         CHECK (status IN ('healthy','failing','stale','unknown')),
  consecutive_failures int  NOT NULL DEFAULT 0,
  alerted_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cron_health_log (
  id          bigserial PRIMARY KEY,
  job_name    text        NOT NULL,
  status_code int,
  error       text,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cron_health_log_time_idx ON public.cron_health_log (observed_at DESC);

ALTER TABLE public.cron_health_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_health_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_health_log      ENABLE ROW LEVEL SECURITY;

-- Read-only for super-admins; writes come from pg_cron (postgres role) and the
-- service-role watcher, both of which bypass RLS. No WITH CHECK(true) write policy.
CREATE POLICY "super-admin reads cron_health_dispatch" ON public.cron_health_dispatch FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads cron_health_state"    ON public.cron_health_state    FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads cron_health_log"      ON public.cron_health_log      FOR SELECT USING (is_super_admin(auth.uid()));
