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

-- NOTE (artists PII): the blanket SELECT above covers public.artists, whose
-- email/phone are "protected" by column-level REVOKEs in migration
-- 20260425202310. Those REVOKEs only bite when NO table-level SELECT grant
-- exists — in Postgres a table-level SELECT covers every column, so a column
-- REVOKE is moot alongside it. Production already has that table-level grant
-- (verified: authenticated has table + email + phone SELECT on artists today),
-- because Supabase's default GRANT ALL was never revoked there. This migration
-- therefore does NOT change the artists PII posture — it is a true no-op on prod
-- and only brings fresh local/CI stacks in line with it.
--
-- It intentionally does NOT try to enforce that column restriction here: the app
-- reads artists through the authenticated client with `select *` /
-- `select id,name,email` (src/data/artists.ts, src/data/hireOrders.ts), so
-- enforcing it would 403 those reads for every user. Properly closing the
-- exposure is an app-level change (a privileged read path or a non-PII view) and
-- is tracked separately, out of scope for this grants-parity migration.
