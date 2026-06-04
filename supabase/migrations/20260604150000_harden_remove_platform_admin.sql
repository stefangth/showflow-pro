-- Phase 4 follow-up: make remove_platform_admin's last-admin guard race-resistant.
-- Counting admins OTHER THAN the target (vs total <= 1) + a table lock closes the TOCTOU
-- window where two concurrent removals each read count = 2 and both delete.
create or replace function public.remove_platform_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller uuid := auth.uid();
begin
  if not public.is_super_admin(v_caller) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  if p_user_id = v_caller then
    raise exception 'You cannot remove your own platform-admin access' using errcode = '42501';
  end if;
  lock table public.platform_admins in share row exclusive mode;
  if (select count(*) from public.platform_admins where user_id <> p_user_id) < 1 then
    raise exception 'Cannot remove the last platform admin' using errcode = '42501';
  end if;
  delete from public.platform_admins where user_id = p_user_id;
end;
$$;
