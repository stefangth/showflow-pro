-- Orgs where p_user is the ONLY admin (blocks account self-deletion that would orphan an org).
create or replace function public.sole_admin_orgs(p_user uuid)
returns table(org_id uuid, org_name text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name
  from public.organizations o
  where exists (
    select 1 from public.org_memberships m
    where m.org_id = o.id and m.user_id = p_user and m.role = 'admin'
  )
  and (
    select count(distinct m2.user_id) from public.org_memberships m2
    where m2.org_id = o.id and m2.role = 'admin' and m2.user_id <> p_user
  ) = 0;
$$;

revoke all on function public.sole_admin_orgs(uuid) from public, anon;
grant execute on function public.sole_admin_orgs(uuid) to authenticated;

-- Account-deletion's SQL half: anonymize shared/audit records, hard-delete personal rows.
-- Idempotent. Does NOT touch auth.users. Guard reads auth.uid() -> callers MUST use the caller's JWT client.
-- NOTE: chat_messages.user_id is NOT NULL so messages are deleted rather than nulled.
create or replace function public.anonymize_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() = p_user or public.is_super_admin(auth.uid())) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  delete from public.blocked_dates
    where artist_id in (select id from public.artists where user_id = p_user);

  update public.artists
    set name = 'Deleted artist', email = null, phone = null, bio = null, user_id = null
    where user_id = p_user;

  -- chat_messages.user_id is NOT NULL; delete the user's messages rather than nulling.
  delete from public.chat_messages where user_id = p_user;

  update public.booking_audit_log set performed_by = null where performed_by = p_user;

  delete from public.notifications where user_id = p_user;
  delete from public.notification_preferences where user_id = p_user;
  delete from public.org_memberships where user_id = p_user;
  delete from public.org_invitations
    where lower(email) = (select lower(email) from auth.users where id = p_user);
  delete from public.profiles where user_id = p_user;
end;
$$;

revoke all on function public.anonymize_user(uuid) from public, anon;
grant execute on function public.anonymize_user(uuid) to authenticated;
