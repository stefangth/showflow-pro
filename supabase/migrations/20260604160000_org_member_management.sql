-- Phase 5: org member management. list_org_members (admin-guarded, aggregates roles)
-- and remove_org_member (admin-guarded, last-admin + self-removal guards).

create or replace function public.list_org_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, roles app_role[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id,
           u.email::text,
           p.display_name,
           array_agg(m.role order by m.role) as roles
    from public.org_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org
    group by m.user_id, u.email, p.display_name
    order by u.email;
end;
$$;
revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;

create or replace function public.remove_org_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_user = v_caller then
    raise exception 'You cannot remove your own membership' using errcode = '42501';
  end if;
  lock table public.org_memberships in share row exclusive mode;
  -- If the target is an admin, block removal that would leave the org with no admins.
  if exists (
        select 1 from public.org_memberships
        where org_id = p_org and user_id = p_user and role = 'admin'
     )
     and (
        select count(distinct user_id) from public.org_memberships
        where org_id = p_org and role = 'admin' and user_id <> p_user
     ) < 1 then
    raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
  end if;
  delete from public.org_memberships where org_id = p_org and user_id = p_user;
end;
$$;
revoke all on function public.remove_org_member(uuid, uuid) from public, anon;
grant execute on function public.remove_org_member(uuid, uuid) to authenticated;
