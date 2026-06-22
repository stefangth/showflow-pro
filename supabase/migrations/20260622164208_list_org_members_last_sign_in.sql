-- list_org_members: add last_sign_in_at so the Members tab can absorb the Users tab.
-- Return-signature change requires drop + recreate (can't CREATE OR REPLACE a changed TABLE).
drop function if exists public.list_org_members(uuid);
create function public.list_org_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, roles app_role[], last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  return query
    select m.user_id,
           u.email::text,
           p.display_name,
           array_agg(m.role order by m.role) as roles,
           u.last_sign_in_at
    from public.org_memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org
    group by m.user_id, u.email, p.display_name, u.last_sign_in_at
    order by u.email;
end;
$$;
revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;
