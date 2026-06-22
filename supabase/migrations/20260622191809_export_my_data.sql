-- The caller's full personal-data export (GDPR access + portability).
-- SECURITY DEFINER so it can read the caller's rows uniformly; scoped strictly to auth.uid().
create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'account', (select to_jsonb(p) from public.profiles p where p.user_id = v_uid),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.org_memberships m where m.user_id = v_uid), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(to_jsonb(a)) from public.artists a where a.user_id = v_uid), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b)) from public.bookings b
                          where b.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(to_jsonb(bd)) from public.blocked_dates bd
                          where bd.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'chat_messages', coalesce((select jsonb_agg(to_jsonb(c)) from public.chat_messages c where c.user_id = v_uid), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n where n.user_id = v_uid), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
