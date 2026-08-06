-- Re-point which auth account owns an artist row (per org). This is the durable fix for
-- the hire-order visibility bug: artist-facing visibility is bound to artists.user_id,
-- and there was no super-admin surface to change it. Enforces one artist per (org, user).
create or replace function public.platform_link_artist(
  p_org uuid, p_user uuid, p_artist_id uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if p_artist_id is null then
    update public.artists set user_id = null
    where org_id = p_org and user_id = p_user;
  else
    if not exists (select 1 from public.artists where id = p_artist_id and org_id = p_org) then
      raise exception 'artist not found in org' using errcode = 'P0001';
    end if;
    -- one artist per (org, user): detach any other artist this user owns in the org
    update public.artists set user_id = null
    where org_id = p_org and user_id = p_user and id <> p_artist_id;
    update public.artists set user_id = p_user where id = p_artist_id;
  end if;

  insert into public.platform_audit_log(actor_user_id, action, target_user_id, org_id, detail)
  values (auth.uid(), 'link_artist', p_user, p_org, jsonb_build_object('artist_id', p_artist_id));
end;
$$;

revoke all on function public.platform_link_artist(uuid, uuid, uuid) from public, anon;
grant execute on function public.platform_link_artist(uuid, uuid, uuid) to authenticated;
