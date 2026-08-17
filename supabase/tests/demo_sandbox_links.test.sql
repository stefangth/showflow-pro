begin;
select plan(11);

-- table + columns exist
select has_table('public','demo_sandbox_links','demo_sandbox_links table exists');
select has_column('public','demo_sandbox_links','token','has token');
select has_column('public','demo_sandbox_links','expires_at','has expires_at');
select has_column('public','demo_sandbox_links','revoked_at','has revoked_at');

-- RLS is enabled
select is(relrowsecurity,true,'RLS enabled')
  from pg_class where oid = 'public.demo_sandbox_links'::regclass;

-- default token is 64 chars and default expiry is ~14 days out
-- (insert as service role / superuser in the test harness, then read back)
insert into public.organizations (id, name, slug, status, is_demo)
  values ('00000000-0000-0000-0000-0000000000d1','Demo Co','demo-co-slink','active',true)
  on conflict (id) do update set is_demo = true;
insert into public.demo_sandbox_links (org_id) values ('00000000-0000-0000-0000-0000000000d1');
select is(
  (select length(token) from public.demo_sandbox_links where org_id='00000000-0000-0000-0000-0000000000d1' limit 1),
  64, 'token defaults to 64 hex chars');
select ok(
  (select expires_at > now() + interval '13 days' and expires_at < now() + interval '15 days'
     from public.demo_sandbox_links where org_id='00000000-0000-0000-0000-0000000000d1' limit 1),
  'expires_at defaults ~14 days out');

-- RLS behaviour (this table backs a PUBLIC leave-behind link, so prove the policies,
-- not just that RLS is on): no anon policy, org-scoped read, no authenticated write.
-- Org d1 (above) already holds one link; add org d2 + one member each.
set session_replication_role = replica;
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-0000-0000-0000-0000000000a2','authenticated','authenticated','slink-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-0000-0000-0000000000b2','authenticated','authenticated','slink-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
set session_replication_role = default;

insert into public.organizations (id, name, slug, status, is_demo)
  values ('00000000-0000-0000-0000-0000000000d2','Demo Co B','demo-co-slink-b','active',true)
  on conflict (id) do update set is_demo = true;
insert into public.org_memberships (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-0000000000a2','admin'),
  ('00000000-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-0000000000b2','admin');

-- No policy targets anon (the public read goes through the service-role sandbox-view fn,
-- never a direct anon PostgREST read).
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='demo_sandbox_links' and 'anon' = any(roles)),
  0, 'no RLS policy targets anon');

-- Org-d1 member reads d1's link; org-d2 member cannot (cross-org isolation).
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-0000000000a2","role":"authenticated"}',true);
set local role authenticated;
select is(
  (select count(*)::int from public.demo_sandbox_links where org_id='00000000-0000-0000-0000-0000000000d1'),
  1, 'org member reads own org link');
-- No authenticated write policy: a direct insert is denied by RLS.
select throws_ok(
  $$ insert into public.demo_sandbox_links (org_id) values ('00000000-0000-0000-0000-0000000000d1') $$,
  '42501', null, 'authenticated cannot directly insert a sandbox link');
reset role;

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-0000000000b2","role":"authenticated"}',true);
set local role authenticated;
select is(
  (select count(*)::int from public.demo_sandbox_links where org_id='00000000-0000-0000-0000-0000000000d1'),
  0, 'non-member cannot read another org link');
reset role;
select set_config('request.jwt.claims', null, true);

select * from finish();
rollback;
