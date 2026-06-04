-- supabase/migrations/20260604131000_org_airtable_vault.sql
-- Per-org Airtable API keys, stored in Supabase Vault (encrypted at rest), kept
-- OUT of member-readable app_settings. Setter is guarded by org-admin; getter is
-- service-role only (read by airtable-poll). Secret name: 'airtable_api_key:'||org.

-- Ensure Vault is enabled. No-op on the prod project (already installed) and on any
-- stack where it is pre-enabled; enables it on the CI local stack (which, like the
-- bootstrap 00000000000000_local_extensions.sql does for pg_cron/pg_net, does not
-- pre-enable it). supabase_vault is non-relocatable and creates its own `vault` schema.
create extension if not exists supabase_vault;

create or replace function public.set_org_airtable_key(_org uuid, _key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := 'airtable_api_key:' || _org::text; v_id uuid;
begin
  if not public.has_org_role(auth.uid(), _org, 'admin') then
    raise exception 'forbidden';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(_key, v_name, 'Airtable API key for org ' || _org::text);
  else
    perform vault.update_secret(v_id, _key);
  end if;
end; $$;

create or replace function public.get_org_airtable_key(_org uuid)
returns text language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'airtable_api_key:' || _org::text
  limit 1
$$;

-- Setter: callable by authenticated (guarded internally by has_org_role).
revoke all on function public.set_org_airtable_key(uuid, text) from public;
grant execute on function public.set_org_airtable_key(uuid, text) to authenticated;

-- Getter: service-role only (edge functions). NOT authenticated.
revoke all on function public.get_org_airtable_key(uuid) from public, authenticated;
grant execute on function public.get_org_airtable_key(uuid) to service_role;
