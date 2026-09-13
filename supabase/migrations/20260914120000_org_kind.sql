-- Workspace type (org_kind): which vocabulary and presentation an org sees.
-- Spec: docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md (R1).

-- 1. Column + CHECK. Existing orgs become 'production' with no data change.
alter table public.organizations
  add column if not exists org_kind text not null default 'production',
  add column if not exists org_kind_set_at timestamptz null;

alter table public.organizations
  drop constraint if exists organizations_org_kind_check,
  add constraint organizations_org_kind_check check (org_kind in ('production','staffing'));

comment on column public.organizations.org_kind is
  'Workspace type: production | staffing. Drives UI vocabulary and presentation only; never data or booking behaviour.';
comment on column public.organizations.org_kind_set_at is
  'When an admin or super-admin explicitly chose the kind. NULL means still on the default; the Get running step reads this.';

-- 2. set_org_kind: org admin (super-admins pass via has_org_role) sets the kind.
--    No admin UPDATE policy is opened on organizations; this RPC is the only admin write path.
create or replace function public.set_org_kind(p_org uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('production','staffing') then
    raise exception 'Unknown workspace type' using errcode = '22023';
  end if;
  update public.organizations
     set org_kind = p_kind, org_kind_set_at = now()
   where id = p_org;
end;
$$;
revoke all on function public.set_org_kind(uuid, text) from public, anon;
grant execute on function public.set_org_kind(uuid, text) to authenticated, service_role;

-- 3. provision_org gains p_org_kind. Adding a defaulted parameter creates a new overload,
--    so the old 4-arg signature is dropped first. Body identical to
--    20260604140000_phase4_platform_console.sql except the organizations insert.
drop function if exists public.provision_org(text, text, text, app_role);

-- ── provision_org: create an org, seed its catalog, create the first-admin invite.
-- Returns { org_id, token }. auth.uid() must be a platform admin (call via the user's JWT).
create or replace function public.provision_org(
  p_name text, p_slug text, p_admin_email text, p_role app_role default 'admin', p_org_kind text default 'production'
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
  if p_org_kind is null or p_org_kind not in ('production','staffing') then
    raise exception 'Unknown workspace type' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, created_by, org_kind, org_kind_set_at)
  values (btrim(p_name), lower(btrim(p_slug)), v_uid, p_org_kind, now())
  returning id into v_org;            -- duplicate slug bubbles up as 23505

  perform public.seed_org_starter_catalog(v_org);

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, lower(btrim(p_admin_email)), p_role, v_uid)
  returning token into v_token;

  return jsonb_build_object('org_id', v_org, 'token', v_token);
end;
$$;
revoke all on function public.provision_org(text,text,text,app_role,text) from public, anon;
grant execute on function public.provision_org(text,text,text,app_role,text) to authenticated;

-- 4. platform_org_stats: append org_kind. RETURNS TABLE signature change requires drop.
--    Body identical to 20260816203826_demo_mode_foundation.sql plus `org_kind text` / `o.org_kind`.
drop function if exists public.platform_org_stats();
create or replace function public.platform_org_stats()
returns table (
  org_id uuid, name text, slug text, status text,
  member_count int, active_artist_count int, bookings_30d int, last_activity_at timestamptz,
  is_demo boolean, org_kind text
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
      ),
      o.is_demo,
      o.org_kind
    from public.organizations o
    order by o.created_at desc;
end;
$$;
revoke all on function public.platform_org_stats() from public, anon;
grant execute on function public.platform_org_stats() to authenticated;
