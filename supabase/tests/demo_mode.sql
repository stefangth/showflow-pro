begin;
select plan(15);

-- Column exists with the safe default.
select has_column('public', 'organizations', 'is_demo', 'organizations.is_demo exists');
select col_default_is('public', 'organizations', 'is_demo', 'false', 'is_demo defaults false');

-- Demo tables exist.
select has_table('public', 'demo_state', 'demo_state table exists');
select has_table('public', 'demo_captured_sends', 'demo_captured_sends table exists');

-- Wipe guard: refuses on a non-demo org.
select throws_ok(
  $$ select public.wipe_demo_org('00000000-0000-0000-0000-00000000b007') $$,
  'P0001',
  'wipe_demo_org refused: 00000000-0000-0000-0000-00000000b007 is not a demo org',
  'wipe guard fires for non-demo org'
);

-- Function-level grants: these are service-role-only (called via the demo-ops edge
-- function). anon/authenticated must NOT be able to call them directly through
-- PostgREST; service_role must. (has_function_privilege works even as superuser,
-- unlike an actual privilege check, so this catches a dropped grant that RLS/pgTAP
-- would otherwise miss.)
select ok(not has_function_privilege('anon', 'public.wipe_demo_org(uuid)', 'execute'), 'wipe_demo_org not executable by anon');
select ok(not has_function_privilege('authenticated', 'public.wipe_demo_org(uuid)', 'execute'), 'wipe_demo_org not executable by authenticated');
select ok(has_function_privilege('service_role', 'public.wipe_demo_org(uuid)', 'execute'), 'wipe_demo_org executable by service_role');
select ok(not has_function_privilege('anon', 'public.seed_demo_org(uuid, text, uuid)', 'execute'), 'seed_demo_org not executable by anon');
select ok(not has_function_privilege('authenticated', 'public.seed_demo_org(uuid, text, uuid)', 'execute'), 'seed_demo_org not executable by authenticated');
select ok(has_function_privilege('service_role', 'public.seed_demo_org(uuid, text, uuid)', 'execute'), 'seed_demo_org executable by service_role');

-- Set up a demo org and seed it.
insert into public.organizations (id, name, slug, status, is_demo)
values ('5eedde00-0000-0000-0000-0000000000d0', 'Demo Co', 'demo-co', 'active', true)
on conflict (id) do update set is_demo = true;
select public.seed_demo_org('5eedde00-0000-0000-0000-0000000000d0', 'full', null);

select cmp_ok(
  (select count(*)::int from public.show_dates where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  '>=', 20, 'seed produces >= 20 show_dates');
select cmp_ok(
  (select count(distinct status)::int from public.bookings where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  '>=', 3, 'seed covers >= 3 booking states');
select cmp_ok(
  (select count(distinct status)::int from public.hire_orders where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  '>=', 3, 'seed covers >= 3 hire-order states');

-- Wipe clears the demo org's tenant rows.
select public.wipe_demo_org('5eedde00-0000-0000-0000-0000000000d0');
select is(
  (select count(*)::int from public.show_dates where org_id = '5eedde00-0000-0000-0000-0000000000d0'),
  0, 'wipe removes show_dates');

select * from finish();
rollback;
