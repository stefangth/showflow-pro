-- set_org_member_role: org admin adds/removes a single role for a member.
-- SECURITY DEFINER + has_org_role('admin') guard; race-safe last-admin guard on remove.
create or replace function public.set_org_member_role(
  p_org uuid, p_user uuid, p_role app_role, p_action text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_action not in ('add','remove') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;

  if p_action = 'add' then
    insert into public.org_memberships (org_id, user_id, role)
    values (p_org, p_user, p_role)
    on conflict (org_id, user_id, role) do nothing;
  else
    lock table public.org_memberships in share row exclusive mode;
    if p_role = 'admin'
       and exists (
         select 1 from public.org_memberships
         where org_id = p_org and user_id = p_user and role = 'admin'
       )
       and (
         select count(distinct user_id) from public.org_memberships
         where org_id = p_org and role = 'admin' and user_id <> p_user
       ) < 1 then
      raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
    end if;
    delete from public.org_memberships
    where org_id = p_org and user_id = p_user and role = p_role;
  end if;
end;
$$;
revoke all on function public.set_org_member_role(uuid, uuid, app_role, text) from public, anon;
grant execute on function public.set_org_member_role(uuid, uuid, app_role, text) to authenticated;
