-- Invite-time membership + artist provisioning, plus self-heal + revoke.
-- ensure_invitation_membership centralizes: membership insert (idempotent) and, for
-- artist invites, claim-by-id → claim-by-email → auto-create. service_role only:
-- called by the edge admin client and (as function OWNER = postgres, which bypasses
-- EXECUTE ACLs) by accept_invitation / claim_my_invitations. Returns artist_linked
-- (false only when an artist_id-stamped claim is skipped by the owner guard, preserving
-- accept_invitation's contract).
create or replace function public.ensure_invitation_membership(p_invitation uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    public.org_invitations;
  v_linked boolean := true;
  v_cnt    int;
begin
  select * into v_inv from public.org_invitations where id = p_invitation;
  if v_inv.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  insert into public.org_memberships (org_id, user_id, role)
  values (v_inv.org_id, p_user, v_inv.role)
  on conflict (org_id, user_id, role) do nothing;

  if v_inv.role = 'artist' then
    if v_inv.artist_id is not null then
      -- Deterministic link by id; guard against the artists(org_id,user_id) partial-unique
      -- index (no-op when the caller already owns an artist in this org).
      update public.artists a
         set user_id = p_user
       where a.id = v_inv.artist_id
         and a.org_id = v_inv.org_id
         and a.user_id is null
         and not exists (
           select 1 from public.artists o
           where o.org_id = v_inv.org_id and o.user_id = p_user
         );
      get diagnostics v_cnt = row_count;
      v_linked := v_cnt > 0;
    else
      -- Plain email invite: claim an unclaimed row by lowercased email. Guard against the
      -- artists(org_id,user_id) partial-unique index the same way the artist_id branch does
      -- (no-op when the caller already owns an artist in this org, rather than raising).
      update public.artists a
         set user_id = p_user
       where a.org_id = v_inv.org_id
         and a.user_id is null
         and lower(a.email) = lower(v_inv.email)
         and not exists (
           select 1 from public.artists o
           where o.org_id = v_inv.org_id and o.user_id = p_user
         );
      get diagnostics v_cnt = row_count;
      if v_cnt = 0
         and not exists (
           select 1 from public.artists o
           where o.org_id = v_inv.org_id and o.user_id = p_user
         ) then
        -- No claimable row and the user owns none → auto-create a minimal profile.
        insert into public.artists (org_id, user_id, email, name)
        values (v_inv.org_id, p_user, lower(v_inv.email), split_part(v_inv.email, '@', 1));
      end if;
    end if;
  end if;

  return v_linked;
end;
$$;
revoke all on function public.ensure_invitation_membership(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_invitation_membership(uuid, uuid) to service_role;

-- accept_invitation, reimplemented to route membership + artist provisioning through
-- ensure_invitation_membership. Contract preserved: returns jsonb {org_id, artist_linked},
-- same not-authenticated / expired-or-invalid / email-mismatch guards.
create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    public.org_invitations;
  v_uid    uuid := auth.uid();
  v_email  text;
  v_linked boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_inv
  from public.org_invitations
  where token = p_token and status = 'pending' and expires_at > now()
  for update;

  if v_inv.id is null then
    -- Idempotent path: claim_my_invitations runs on every authenticated load (BEFORE
    -- AcceptInvitePage's effect) and may have already flipped THIS token to 'accepted'
    -- for THIS user. Treat "already accepted by me + I'm a member of that org" as success
    -- so the invite-link happy path doesn't surface a bogus "invalid or expired" error.
    select * into v_inv
    from public.org_invitations
    where token = p_token and status = 'accepted';
    if v_inv.id is not null
       and lower(v_inv.email) = lower(coalesce(v_email, ''))
       and exists (
         select 1 from public.org_memberships m
         where m.org_id = v_inv.org_id and m.user_id = v_uid
       ) then
      return jsonb_build_object('org_id', v_inv.org_id, 'artist_linked', true);
    end if;
    raise exception 'Invalid or expired invitation' using errcode = 'P0002';
  end if;

  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'Invitation was issued to a different email' using errcode = '42501';
  end if;

  v_linked := public.ensure_invitation_membership(v_inv.id, v_uid);

  update public.org_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id;

  return jsonb_build_object('org_id', v_inv.org_id, 'artist_linked', v_linked);
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to service_role;

-- claim_my_invitations: reconcile every pending, non-expired invitation for the caller's
-- email on ANY authenticated load (invite link, recovery, plain login). This is what makes
-- membership + artist profile + invite status self-heal without SQL backfill. Rows already
-- past their ~14-day expires_at are NOT reconciled here (a fresh invite must be resent).
-- Matches on lower(email) EXACTLY: gracicalma's googlemail invite reconciles only against a
-- googlemail login (correct per the auth logs); do NOT normalize googlemail<->gmail.
create or replace function public.claim_my_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_count int := 0;
  r       record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    return 0;
  end if;

  for r in
    select id from public.org_invitations
    where lower(email) = lower(v_email)
      and status = 'pending'
      and expires_at > now()
    for update
  loop
    perform public.ensure_invitation_membership(r.id, v_uid);
    update public.org_invitations set status = 'accepted', accepted_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.claim_my_invitations() from public, anon;
grant execute on function public.claim_my_invitations() to authenticated;

-- revoke_invitation: mark a PENDING invitation revoked AND remove the membership row the
-- invite created at invite time (else revoke would strand an orphaned member). Admin OR
-- super-admin (platform OrgInvitePopover runs as a super-admin who isn't an org member).
-- The status guard prevents revoking an already-accepted invite (which would strip a
-- member's genuinely-earned membership). Last-admin guard mirrors remove_org_member.
create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_inv    public.org_invitations;
  v_user   uuid;
begin
  select * into v_inv from public.org_invitations where id = p_id;
  if v_inv.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if not (public.has_org_role(v_caller, v_inv.org_id, 'admin') or public.is_super_admin(v_caller)) then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked';
  end if;

  update public.org_invitations set status = 'revoked' where id = p_id;

  -- Resolve the invitee's auth user and drop the (org, user, invited-role) membership the
  -- invite created. Only that exact role row — an independently-earned role is untouched.
  -- This is safe by construction: create-invitation rejects inviting an existing member
  -- (409), so a still-pending invite's (org,user,invited-role) row can only be the one the
  -- invite itself created at invite time.
  select id into v_user from auth.users where lower(email) = lower(v_inv.email);
  if v_user is not null then
    lock table public.org_memberships in share row exclusive mode;
    if v_inv.role = 'admin'
       and exists (
         select 1 from public.org_memberships
         where org_id = v_inv.org_id and user_id = v_user and role = 'admin'
       )
       and (
         select count(distinct user_id) from public.org_memberships
         where org_id = v_inv.org_id and role = 'admin' and user_id <> v_user
       ) < 1 then
      raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
    end if;
    delete from public.org_memberships
    where org_id = v_inv.org_id and user_id = v_user and role = v_inv.role;
  end if;
end;
$$;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
