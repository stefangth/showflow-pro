-- Spec A: member-guarded status feed for the artist-card chip. Returns only the
-- artist ids (non-PII) in p_org that have a LIVE pending invite -- id-stamped or
-- legacy email-matched -- so producers can see "Invited" without any invitation PII
-- crossing the ADR-0011 boundary. "Active" needs no RPC (it's artists.user_id).
create or replace function public.list_pending_invited_artists(p_org uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(auth.uid(), p_org) then
    raise exception 'Forbidden: org members only' using errcode = '42501';
  end if;
  return query
    select distinct a.id
    from public.artists a
    join public.org_invitations i
      on i.org_id = a.org_id
     and i.status = 'pending'
     and i.expires_at > now()
     and (
       i.artist_id = a.id
       or (i.artist_id is null and lower(i.email) = lower(a.email))
     )
    where a.org_id = p_org;
end;
$$;

revoke all on function public.list_pending_invited_artists(uuid) from public, anon;
grant execute on function public.list_pending_invited_artists(uuid) to authenticated;
