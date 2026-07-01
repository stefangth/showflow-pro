-- Spec A follow-up (review): accept_invitation now returns jsonb {org_id, artist_linked}
-- so the accept-invite UI can warn when a deterministic (artist_id) link was skipped
-- because the caller already owns an artist in the org (the no-op guard). Legacy
-- (no artist_id) invites report artist_linked=true (nothing to deterministically link).
-- Return type changes uuid->jsonb, so drop+recreate; ACL is re-granted to match prior
-- (execute: authenticated, service_role).
drop function if exists public.accept_invitation(text);

create function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    public.org_invitations;
  v_uid    uuid := auth.uid();
  v_email  text;
  v_linked boolean := true;  -- true unless an artist_id-stamped link was skipped
  v_cnt    int;
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
    get diagnostics v_cnt = row_count;
    v_linked := v_cnt > 0;  -- false => the id-stamped link was skipped by the guard
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

  return jsonb_build_object('org_id', v_inv.org_id, 'artist_linked', v_linked);
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to service_role;
