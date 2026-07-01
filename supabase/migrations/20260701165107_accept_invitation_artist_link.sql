-- Spec A: accept_invitation links the artist deterministically by artist_id when
-- the invitation carries one, else falls back to the legacy lowercased-email match.
-- Guards on the artist_id branch: never re-claim a linked row, and no-op when the
-- caller already owns an artist in the org so we never trip the
-- artists_org_user_uniq (org_id, user_id) partial-unique index (membership is still
-- created). The legacy email branch is unchanged from prod. CREATE OR REPLACE
-- preserves the existing ACL (execute: authenticated, service_role).
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

  if v_inv.artist_id is not null then
    -- Deterministic link by id. Guard: only claim an unclaimed row, and only when
    -- the caller does not already own an artist in this org (else the unique index
    -- would fire; here it simply no-ops and the membership still stands).
    update public.artists a
       set user_id = v_uid
     where a.id = v_inv.artist_id
       and a.org_id = v_inv.org_id
       and a.user_id is null
       and not exists (
         select 1 from public.artists o
         where o.org_id = v_inv.org_id
           and o.user_id = v_uid
       );
  else
    -- Legacy / Admin-tab invites: claim an unclaimed row by lowercased email.
    update public.artists a
    set user_id = v_uid
    where a.org_id = v_inv.org_id
      and a.user_id is null
      and lower(a.email) = lower(v_inv.email);
  end if;

  update public.org_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id;

  return v_inv.org_id;
end;
$$;
