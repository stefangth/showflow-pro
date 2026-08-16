begin;
select plan(4);

-- Column exists with the safe default.
select has_column('public', 'organizations', 'is_demo', 'organizations.is_demo exists');
select col_default_is('public', 'organizations', 'is_demo', 'false', 'is_demo defaults false');

-- Demo tables exist.
select has_table('public', 'demo_state', 'demo_state table exists');
select has_table('public', 'demo_captured_sends', 'demo_captured_sends table exists');

select * from finish();
rollback;
