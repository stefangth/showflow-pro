-- private.runtime_config (added by 20260809140000) holds the non-prod dispatch-host override, and it
-- is written by supabase/seed.sql. On Supabase preview branches the seed runs as `service_role`, not
-- the `postgres` table owner, and service_role has no implicit access to the `private` schema — so the
-- seed's INSERT fails with "permission denied for schema private" and the entire preview branch fails
-- to seed (observed on PR #230's preview branch). seed.sql never runs on production, so prod is
-- unaffected either way; this only unblocks local/CI/preview seeding.
--
-- Grant service_role exactly what the seed needs, and no more. Deliberately NOT granted to
-- anon/authenticated: the dispatch host must never be writable by end users — a write would let them
-- redirect cron/trigger dispatch to an attacker URL and leak the X-Cron-Secret header. service_role
-- already bypasses RLS and holds the cron secret, so this is no new escalation for it. Mirrors the
-- explicit-grant approach of 20260808201308 (newer Supabase strips implicit grants; make them explicit).
grant usage on schema private to service_role;
grant select, insert, update on private.runtime_config to service_role;
