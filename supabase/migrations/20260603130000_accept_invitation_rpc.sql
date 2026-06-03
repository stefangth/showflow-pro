-- Phase 1B (1/n): accept_invitation RPC — invite-based onboarding.
-- An authenticated invitee redeems a token: it creates their org_membership,
-- claims a producer-created artist row for that org (by email, if present), and
-- marks the invitation accepted. SECURITY DEFINER so it can write membership rows
-- regardless of the caller's (as-yet nonexistent) org role.

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv   public.org_invitations;
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_inv
  from public.org_invitations
  where token = p_token
    and status = 'pending'
    and expires_at > now()
  for update;

  if v_inv.id is null then
    raise exception 'Invalid or expired invitation' using errcode = 'P0002';
  end if;

  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'Invitation was issued to a different email' using errcode = '42501';
  end if;

  insert into public.org_memberships (org_id, user_id, role)
  values (v_inv.org_id, v_uid, v_inv.role)
  on conflict (org_id, user_id, role) do nothing;

  -- Claim an unclaimed, producer-created artist row for this org + email.
  update public.artists a
  set user_id = v_uid
  where a.org_id = v_inv.org_id
    and a.user_id is null
    and lower(a.email) = lower(v_inv.email);

  update public.org_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id;

  return v_inv.org_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
revoke all on function public.accept_invitation(text) from anon;
grant execute on function public.accept_invitation(text) to authenticated;
