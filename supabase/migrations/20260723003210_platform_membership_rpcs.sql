-- Super-admin membership mutations for the platform Users console. The existing
-- set_org_member_role / remove_org_member RPCs hard-require org-admin (has_org_role)
-- and reject cross-org super-admins, so these platform_* twins are is_super_admin-guarded
-- and carry the same last-admin guard. Every call appends a platform_audit_log row.

create or replace function public.platform_set_membership(
  p_org uuid, p_user uuid, p_role app_role, p_action text
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
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
       and exists (select 1 from public.org_memberships
                   where org_id = p_org and user_id = p_user and role = 'admin')
       and (select count(distinct user_id) from public.org_memberships
            where org_id = p_org and role = 'admin') <= 1
    then
      raise exception 'org must keep at least one admin' using errcode = 'P0001';
    end if;
    delete from public.org_memberships
    where org_id = p_org and user_id = p_user and role = p_role;
  end if;

  insert into public.platform_audit_log(actor_user_id, action, target_user_id, org_id, detail)
  values (auth.uid(), 'set_membership', p_user, p_org,
          jsonb_build_object('role', p_role, 'action', p_action));
end;
$$;

create or replace function public.platform_remove_membership(
  p_org uuid, p_user uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  lock table public.org_memberships in share row exclusive mode;
  if exists (select 1 from public.org_memberships
             where org_id = p_org and user_id = p_user and role = 'admin')
     and (select count(distinct user_id) from public.org_memberships
          where org_id = p_org and role = 'admin') <= 1
  then
    raise exception 'org must keep at least one admin' using errcode = 'P0001';
  end if;
  delete from public.org_memberships where org_id = p_org and user_id = p_user;

  insert into public.platform_audit_log(actor_user_id, action, target_user_id, org_id)
  values (auth.uid(), 'remove_membership', p_user, p_org);
end;
$$;

revoke all on function public.platform_set_membership(uuid, uuid, app_role, text) from public, anon;
revoke all on function public.platform_remove_membership(uuid, uuid) from public, anon;
grant execute on function public.platform_set_membership(uuid, uuid, app_role, text) to authenticated;
grant execute on function public.platform_remove_membership(uuid, uuid) to authenticated;
