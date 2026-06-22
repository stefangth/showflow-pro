-- supabase/migrations/20260622190204_org_airtable_key_status.sql
-- Admin-facing status + delete for the per-org Airtable PAT stored in Supabase Vault
-- (see 20260604131000_org_airtable_vault.sql). Neither function reads or returns the
-- decrypted secret: status exposes presence + last-updated only; delete removes the row.
-- Both are admin-guarded via has_org_role (which short-circuits on super-admin) and
-- granted to authenticated, mirroring set_org_airtable_key.

-- Presence + last-updated ONLY. Never returns the decrypted secret.
create or replace function public.get_org_airtable_key_status(_org uuid)
returns table(present boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_name text := 'airtable_api_key:' || _org::text;
begin
  if not public.has_org_role(auth.uid(), _org, 'admin') then
    raise exception 'forbidden';
  end if;
  return query
    select exists(select 1 from vault.secrets where name = v_name),
           (select s.updated_at from vault.secrets s where s.name = v_name limit 1);
end; $$;

create or replace function public.delete_org_airtable_key(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), _org, 'admin') then
    raise exception 'forbidden';
  end if;
  delete from vault.secrets where name = 'airtable_api_key:' || _org::text;
end; $$;

revoke all on function public.get_org_airtable_key_status(uuid) from public;
grant execute on function public.get_org_airtable_key_status(uuid) to authenticated;
revoke all on function public.delete_org_airtable_key(uuid) from public;
grant execute on function public.delete_org_airtable_key(uuid) to authenticated;
