begin;
select plan(7);

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

select * from finish();
rollback;
