create or replace function public.list_org_admin_names(p_org uuid)
returns setof text language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_org_member(auth.uid(), p_org) then
    raise exception 'Forbidden: org members only' using errcode = '42501';
  end if;
  return query
    select distinct p.display_name
    from public.org_memberships m
    join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org and m.role = 'admin' and p.display_name is not null and p.display_name <> ''
    order by p.display_name;
end; $$;
revoke all on function public.list_org_admin_names(uuid) from public, anon;
grant execute on function public.list_org_admin_names(uuid) to authenticated;
