-- rename_org: let an org admin rename their own org (name only; slug unchanged).
-- SECURITY DEFINER + has_org_role('admin') guard (short-circuits on is_super_admin).
create or replace function public.rename_org(p_org uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Organization name is required' using errcode = '22023';
  end if;
  update public.organizations set name = btrim(p_name) where id = p_org;
end;
$$;
revoke all on function public.rename_org(uuid, text) from public, anon;
grant execute on function public.rename_org(uuid, text) to authenticated;
