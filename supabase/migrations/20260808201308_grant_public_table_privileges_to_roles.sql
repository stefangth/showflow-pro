-- Make the baseline table/sequence privileges for the Supabase API roles
-- explicit, instead of depending on the CLI's built-in default-privileges
-- bootstrap.
--
-- Why: the schema has always relied on Supabase's implicit
-- "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role"
-- (RLS then governs row access) — no repo migration grants table DML directly.
-- That bootstrap changed in Supabase CLI releases after CI's pinned 2.98.2: on
-- the local stack under a newer CLI the roles end up WITHOUT SELECT/INSERT/
-- UPDATE/DELETE on the tables, so every RLS/RPC pgTAP test and the e2e seed fail
-- with "permission denied for table ...". On hosted prod (and CLI 2.98.2) these
-- grants already exist, so this migration is a no-op there — it only removes the
-- hidden dependency on a specific CLI version.
--
-- Scope: tables and sequences only. Functions are deliberately excluded — Postgres
-- already grants EXECUTE to PUBLIC on every CREATE FUNCTION, and the repo hardens
-- specific routines to service-role-only (e.g.
-- 20260703100321_harden_rpc_grants_service_role_only). A blanket routine grant
-- here would silently undo that hardening.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- Cover tables/sequences added by future migrations too. Migrations run as (and
-- own their objects as) postgres, so scope the default to that role.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
