-- Enable extensions that later migrations use.
--
-- In production these are enabled out-of-band via the Supabase dashboard
-- (pg_cron) or by an earlier migration (pg_net), so this file is a no-op
-- there. Locally — and in CI via `supabase start` — the extensions must be
-- enabled explicitly before `cron.schedule(...)` is called by
-- 20260514290000_pg_cron_schedules.sql.
--
-- The 00000000000000 prefix ensures this runs before every other migration
-- regardless of when it was added.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
