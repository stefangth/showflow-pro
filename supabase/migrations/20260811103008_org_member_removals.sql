-- Tombstones for org-member removal. Admin > People shows a "Recently removed" group
-- (who left, when, by whom) with Undo, Clear from list, and — only for a user whose
-- last org this was — Delete account. Removal STILL hard-deletes the org_memberships
-- row, so is_org_member / has_org_role and every RLS policy built on them are untouched;
-- this table is presentational + audit only, and carries the snapshot Undo needs.

create table public.org_member_removals (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  roles        app_role[] not null,
  removed_at   timestamptz not null default now(),
  removed_by   uuid,
  primary key (org_id, user_id)
);
alter table public.org_member_removals enable row level security;

-- Org admins (and super-admins, via has_org_role) manage their org's tombstones.
-- One FOR ALL policy covers select/insert/update/delete.
create policy "org admins manage removals" on public.org_member_removals
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));

-- RESTRICTIVE pooled-tenancy isolation, matching every other tenant table (ADR-0003).
create policy "org_isolation" on public.org_member_removals as restrictive
  for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

create index org_member_removals_org_idx on public.org_member_removals (org_id, removed_at desc);

-- remove_org_member: keep the three guards (admin-only, not self, not last admin),
-- then snapshot roles/email/name and upsert the tombstone in the same transaction as
-- the hard delete.
create or replace function public.remove_org_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_roles  app_role[];
  v_email  text;
  v_name   text;
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_user = v_caller then
    raise exception 'You cannot remove your own membership' using errcode = '42501';
  end if;
  lock table public.org_memberships in share row exclusive mode;
  if exists (select 1 from public.org_memberships where org_id = p_org and user_id = p_user and role = 'admin')
     and (select count(distinct user_id) from public.org_memberships
          where org_id = p_org and role = 'admin' and user_id <> p_user) < 1 then
    raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
  end if;

  select array_agg(role order by role) into v_roles
    from public.org_memberships where org_id = p_org and user_id = p_user;
  -- Only an actual member can be tombstoned. Without this, an admin could fabricate a
  -- tombstone for any user_id (roles NULL, deleting nothing) and then Delete-account any
  -- membership-less user globally via admin_anonymize_removed_user.
  if v_roles is null then
    raise exception 'User is not a member of this organization' using errcode = 'P0002';
  end if;
  select u.email::text, p.display_name into v_email, v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
    where u.id = p_user;

  delete from public.org_memberships where org_id = p_org and user_id = p_user;

  insert into public.org_member_removals (org_id, user_id, email, display_name, roles, removed_at, removed_by)
  values (p_org, p_user, v_email, v_name, coalesce(v_roles, '{}'), now(), v_caller)
  on conflict (org_id, user_id)
  do update set email = excluded.email, display_name = excluded.display_name,
                roles = excluded.roles, removed_at = excluded.removed_at, removed_by = excluded.removed_by;
end;
$$;

-- list_removed_members: the "Recently removed" feed. deletable = the user now has NO
-- membership in ANY org (this was their last one, so a full delete affects nobody else)
-- AND is not a platform admin (super-admins are never deletable from the org surface).
create or replace function public.list_removed_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, roles app_role[],
               removed_at timestamptz, removed_by_name text, deletable boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  return query
    select r.user_id, r.email, r.display_name, r.roles, r.removed_at,
           actor.display_name as removed_by_name,
           (not exists (select 1 from public.org_memberships m where m.user_id = r.user_id)
            and not public.is_super_admin(r.user_id)) as deletable
    from public.org_member_removals r
    left join public.profiles actor on actor.user_id = r.removed_by
    where r.org_id = p_org
    order by r.removed_at desc;
end;
$$;

revoke all on function public.list_removed_members(uuid) from public, anon;
grant execute on function public.list_removed_members(uuid) to authenticated;

-- Undo: re-insert the snapshot memberships, delete the tombstone. Idempotent per role.
create or replace function public.restore_org_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_roles app_role[];
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  select roles into v_roles from public.org_member_removals where org_id = p_org and user_id = p_user;
  if v_roles is null then
    raise exception 'No removed member to restore' using errcode = 'P0002';
  end if;
  insert into public.org_memberships (org_id, user_id, role)
  select p_org, p_user, unnest(v_roles)
  on conflict (org_id, user_id, role) do nothing;
  delete from public.org_member_removals where org_id = p_org and user_id = p_user;
end;
$$;

-- Clear from list: dismiss the tombstone only; the account is untouched.
create or replace function public.clear_removed_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  delete from public.org_member_removals where org_id = p_org and user_id = p_user;
end;
$$;

revoke all on function public.restore_org_member(uuid, uuid) from public, anon;
revoke all on function public.clear_removed_member(uuid, uuid) from public, anon;
grant execute on function public.restore_org_member(uuid, uuid) to authenticated;
grant execute on function public.clear_removed_member(uuid, uuid) to authenticated;

-- Private: the anonymization statements only (no auth check). Transcribed verbatim from
-- the CURRENT anonymize_user body in 20260723183038 (which added the hire_order_signatures
-- and hire_orders null-outs — do not reconcile against the older 20260711011420) so the two
-- guarded wrappers below share ONE body and can never drift. Revoked from everyone so it is
-- reachable only via those wrappers.
create or replace function public._anonymize_user_data(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = p_user;

  delete from public.blocked_dates
    where artist_id in (select id from public.artists where user_id = p_user);

  update public.artists
    set name = 'Deleted artist', email = null, phone = null, bio = null, user_id = null
    where user_id = p_user;

  -- chat_messages.user_id is NOT NULL; delete the user's messages rather than nulling.
  delete from public.chat_messages where user_id = p_user;

  update public.booking_audit_log set performed_by = null where performed_by = p_user;
  update public.hire_order_signatures set signer_user_id = null where signer_user_id = p_user;
  update public.hire_orders set created_by = null where created_by = p_user;

  delete from public.notifications where user_id = p_user;
  delete from public.notification_preferences where user_id = p_user;
  delete from public.org_memberships where user_id = p_user;
  delete from public.org_invitations
    where lower(email) = (select lower(email) from auth.users where id = p_user);
  delete from public.profiles where user_id = p_user;

  if v_email is not null then
    update public.email_send_log set recipient_email = '[anonymized]'
      where lower(recipient_email) = v_email;
    delete from public.email_unsubscribe_tokens where lower(email) = v_email;
  end if;
end;
$$;
revoke all on function public._anonymize_user_data(uuid) from public, anon, authenticated;

-- GDPR path: keep its self/super-admin guard, delegate the body to the shared helper.
create or replace function public.anonymize_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() = p_user or public.is_super_admin(auth.uid())) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform public._anonymize_user_data(p_user);
end;
$$;

-- Org-admin path: erase a removed member's account, but ONLY when this is their last org
-- (no membership anywhere) so no other org is affected. Guarded three ways.
create or replace function public.admin_anonymize_removed_user(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_member_removals where org_id = p_org and user_id = p_user) then
    raise exception 'User was not removed from this organization' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.org_memberships where user_id = p_user) then
    raise exception 'User still belongs to another organization' using errcode = 'P0001';
  end if;
  -- A platform admin (super-admin) may hold, or have held, an org membership independent of
  -- their platform-admin status; deleting them here would let an org admin erase a super-admin
  -- (potentially the last one). Platform-admin deletion is exclusively the platform console's
  -- job (platform-manage-user, which guards the last super-admin).
  if public.is_super_admin(p_user) then
    raise exception 'Cannot delete a platform administrator' using errcode = 'P0001';
  end if;
  perform public._anonymize_user_data(p_user);
end;
$$;

revoke all on function public.admin_anonymize_removed_user(uuid, uuid) from public, anon;
grant execute on function public.admin_anonymize_removed_user(uuid, uuid) to authenticated;

-- Re-adding a removed member (accept_invitation, set_org_member_role/platform_set_membership
-- add, or Undo) must clear their tombstone, else list_removed_members keeps showing them and
-- they render in both Members and Recently removed. A trigger on org_memberships INSERT is the
-- one place every re-add path funnels through. restore_org_member also deletes the tombstone
-- explicitly, so its own re-insert just makes this a harmless no-op.
create or replace function public.clear_removal_tombstone_on_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.org_member_removals where org_id = new.org_id and user_id = new.user_id;
  return new;
end;
$$;

create trigger clear_removal_tombstone_after_membership_insert
  after insert on public.org_memberships
  for each row execute function public.clear_removal_tombstone_on_membership();
