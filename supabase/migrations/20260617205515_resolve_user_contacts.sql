-- Phase 5: resolve_user_contacts — batched login email + display_name lookup by
-- user_id, for the offer/confirmation digests (ADR-0011). Reads auth.users, so it
-- is SECURITY DEFINER and granted to service_role ONLY (the digests run as
-- service role). The frontend never calls this; it reuses list_org_members.
create or replace function public.resolve_user_contacts(p_user_ids uuid[])
returns table (user_id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.display_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = any(p_user_ids);
$$;

revoke all on function public.resolve_user_contacts(uuid[]) from public, anon, authenticated;
grant execute on function public.resolve_user_contacts(uuid[]) to service_role;
