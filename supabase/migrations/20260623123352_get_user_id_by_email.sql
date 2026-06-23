-- Resolve an email address to its auth user id (case-insensitive). Used by the
-- send-transactional-email per-category preference gate to replace the listUsers()
-- first-page scan, which silently failed open for recipients beyond the first page.
-- Service-role only (the edge function calls it via the admin client) — not granted to
-- authenticated, so it can't be used as an email-enumeration oracle.
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
$$;
revoke all on function public.get_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;
