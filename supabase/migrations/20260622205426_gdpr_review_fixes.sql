-- Review fix [HIGH]: sole_admin_orgs was callable with any uuid (information disclosure).
-- Self-scope it via a WHERE guard so non-self/non-super-admin callers get an empty result.
create or replace function public.sole_admin_orgs(p_user uuid)
returns table(org_id uuid, org_name text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name
  from public.organizations o
  where (auth.uid() = p_user or public.is_super_admin(auth.uid()))
  and exists (
    select 1 from public.org_memberships m
    where m.org_id = o.id and m.user_id = p_user and m.role = 'admin'
  )
  and (
    select count(distinct m2.user_id) from public.org_memberships m2
    where m2.org_id = o.id and m2.role = 'admin' and m2.user_id <> p_user
  ) = 0;
$$;
revoke all on function public.sole_admin_orgs(uuid) from public, anon;
grant execute on function public.sole_admin_orgs(uuid) to authenticated;

-- Review fix [MEDIUM]: include notification_preferences + artist_skills (personal data, GDPR Art. 20)
-- and cap the unbounded high-volume relations to avoid OOM on large accounts. schema_version -> 2.
create or replace function public.export_my_data()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'schema_version', 2,
    'exported_at', now(),
    'account', (select to_jsonb(p) from public.profiles p where p.user_id = v_uid),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m)) from public.org_memberships m where m.user_id = v_uid), '[]'::jsonb),
    'notification_preferences', coalesce((select jsonb_agg(to_jsonb(np)) from public.notification_preferences np where np.user_id = v_uid), '[]'::jsonb),
    'artists', coalesce((select jsonb_agg(to_jsonb(a)) from public.artists a where a.user_id = v_uid), '[]'::jsonb),
    'artist_skills', coalesce((select jsonb_agg(to_jsonb(s)) from public.artist_skills s
                          where s.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(to_jsonb(b)) from public.bookings b
                          where b.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(to_jsonb(bd)) from public.blocked_dates bd
                          where bd.artist_id in (select id from public.artists where user_id = v_uid)), '[]'::jsonb),
    'chat_messages', coalesce((select jsonb_agg(to_jsonb(c)) from
                          (select * from public.chat_messages where user_id = v_uid order by created_at limit 100000) c), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from
                          (select * from public.notifications where user_id = v_uid order by created_at desc limit 100000) n), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
