-- C1 — Move the cron_secret out of member-readable app_settings and into Supabase Vault.
--
-- Problem: app_settings has a permissive `USING (true)` SELECT policy for the
-- `authenticated` role, and the restrictive org_isolation policy permits `org_id IS NULL`
-- rows. The cron_secret row is stored with org_id NULL, so ANY authenticated user could
-- `select value from app_settings where key='cron_secret'` — that secret is the only gate
-- on six `verify_jwt=false` cron functions. Moving it to Vault (encrypted at rest, no
-- member-readable table) closes the leak. Both sides that read it move together:
--   • the in-DB pg_cron dispatch reads it via private.cron_secret()
--   • the edge functions read it via requireCronOrRole → public.get_cron_secret() RPC
--     (PostgREST cannot reach the vault/private schemas, so the edge fn needs a public,
--      service-role-only RPC).
--
-- Matches the established Vault pattern from 20260604131000_org_airtable_vault.sql
-- (vault.create_secret / vault.decrypted_secrets, SECURITY DEFINER, service-role-only getter).
--
-- IMPORTANT: this migration reads the EXISTING app_settings cron_secret value and stores
-- THAT (no rotation), so the live pg_cron jobs keep authenticating without a coordinated
-- redeploy. The cron jobs call private.cron_secret() by reference at dispatch time, so
-- redefining that function is enough — no cron.schedule() reschedule is required.

-- Ensure Vault is enabled (no-op on prod; enables it on the CI local stack).
create extension if not exists supabase_vault;

-- 1) Seed the Vault secret from the EXISTING app_settings value (do NOT regenerate).
--    Idempotent: skip if a 'cron_secret' Vault secret already exists; otherwise, if the
--    app_settings row is present, copy its value; if neither exists (fresh stack), mint one.
do $$
declare
  v_existing_vault_id uuid;
  v_app_value text;
begin
  select id into v_existing_vault_id from vault.secrets where name = 'cron_secret' limit 1;
  if v_existing_vault_id is not null then
    return; -- already migrated
  end if;

  select value #>> '{}' into v_app_value
  from public.app_settings
  where key = 'cron_secret'
  order by (org_id is null) desc
  limit 1;

  if v_app_value is null or v_app_value = '' then
    -- No pre-existing secret (fresh environment): mint a fresh one so cron still works.
    v_app_value := encode(gen_random_bytes(32), 'hex');
  end if;

  perform vault.create_secret(v_app_value, 'cron_secret', 'Shared secret for pg_cron → edge function authentication');
end $$;

-- 2) Redefine the in-DB dispatch read path to read from Vault instead of app_settings.
--    Adds the previously-missing `SET search_path` (audit finding #5). Kept SECURITY DEFINER
--    so pg_cron (which runs as the table owner / postgres) can decrypt regardless of the
--    caller. Existing cron.schedule() commands reference this function, so they pick up the
--    new source automatically with no reschedule.
create or replace function private.cron_secret() returns text
language sql stable security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
$$;

-- 3) Public getter for the edge functions (PostgREST can't reach vault/private schemas).
--    Service-role only — never granted to public/anon/authenticated.
create or replace function public.get_cron_secret() returns text
language sql stable security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
$$;

revoke all on function public.get_cron_secret() from public, anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;

-- 4) Delete the now-migrated cron_secret row from app_settings so no member-readable table
--    holds the secret. (The sync_show_dates_on_settings_update trigger only reacts to
--    'sub_program_slots_defaults', so deleting this row does not cascade.)
delete from public.app_settings where key = 'cron_secret';
