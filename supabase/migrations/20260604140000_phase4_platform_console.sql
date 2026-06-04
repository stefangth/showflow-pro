-- Phase 4: platform console RPCs. All SECURITY DEFINER + is_super_admin-gated.
-- provision_org is atomic (one function = one txn): org + starter catalog + first-admin invite.

-- ── provision_org: create an org, seed its catalog, create the first-admin invite.
-- Returns { org_id, token }. auth.uid() must be a platform admin (call via the user's JWT).
create or replace function public.provision_org(
  p_name text, p_slug text, p_admin_email text, p_role app_role default 'admin'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_token text; v_uid uuid := auth.uid();
begin
  if not public.is_super_admin(v_uid) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name),'') = '' or coalesce(btrim(p_slug),'') = '' or coalesce(btrim(p_admin_email),'') = '' then
    raise exception 'name, slug and admin_email are required' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), v_uid)
  returning id into v_org;            -- duplicate slug bubbles up as 23505

  perform public.seed_org_starter_catalog(v_org);

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, lower(btrim(p_admin_email)), p_role, v_uid)
  returning token into v_token;

  return jsonb_build_object('org_id', v_org, 'token', v_token);
end;
$$;
revoke all on function public.provision_org(text,text,text,app_role) from public, anon;
grant execute on function public.provision_org(text,text,text,app_role) to authenticated;

-- ── platform_org_stats: one row per org (super-admin only). The only cross-tenant read.
create or replace function public.platform_org_stats()
returns table (
  org_id uuid, name text, slug text, status text,
  member_count int, active_artist_count int, bookings_30d int, last_activity_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  return query
    select
      o.id, o.name, o.slug, o.status,
      (select count(distinct m.user_id)::int from public.org_memberships m where m.org_id = o.id),
      (select count(*)::int from public.artists a where a.org_id = o.id and a.status = 'active'),
      (select count(*)::int from public.bookings b where b.org_id = o.id and b.created_at >= now() - interval '30 days'),
      greatest(
        (select max(b.created_at)  from public.bookings b      where b.org_id  = o.id),
        (select max(sd.created_at) from public.show_dates sd    where sd.org_id = o.id),
        (select max(cm.created_at) from public.chat_messages cm where cm.org_id = o.id)
      )
    from public.organizations o
    order by o.created_at desc;
end;
$$;
revoke all on function public.platform_org_stats() from public, anon;
grant execute on function public.platform_org_stats() to authenticated;

-- ── Manage platform admins (super-admin only) with last-admin + self-demote guards.
create or replace function public.add_platform_admin(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_caller uuid := auth.uid();
begin
  if not public.is_super_admin(v_caller) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'No user with that email' using errcode = 'P0002';
  end if;
  insert into public.platform_admins (user_id) values (v_uid) on conflict (user_id) do nothing;
  return v_uid;
end;
$$;
revoke all on function public.add_platform_admin(text) from public, anon;
grant execute on function public.add_platform_admin(text) to authenticated;

create or replace function public.remove_platform_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.is_super_admin(v_caller) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'You cannot remove your own platform-admin access' using errcode = '42501';
  end if;
  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'Cannot remove the last platform admin' using errcode = '42501';
  end if;
  delete from public.platform_admins where user_id = p_user_id;
end;
$$;
revoke all on function public.remove_platform_admin(uuid) from public, anon;
grant execute on function public.remove_platform_admin(uuid) to authenticated;

create or replace function public.list_platform_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  return query
    select pa.user_id, u.email::text, pa.created_at
    from public.platform_admins pa join auth.users u on u.id = pa.user_id
    order by pa.created_at;
end;
$$;
revoke all on function public.list_platform_admins() from public, anon;
grant execute on function public.list_platform_admins() to authenticated;
