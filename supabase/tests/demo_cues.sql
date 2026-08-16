begin;
select plan(3);

-- Scene + sim-clock columns (Phase 2) exist on demo_state.
select has_column('public', 'demo_state', 'sim_now', 'demo_state.sim_now exists');
select has_column('public', 'demo_state', 'current_scene_id', 'demo_state.current_scene_id exists');
select has_column('public', 'demo_state', 'script_id', 'demo_state.script_id exists');

select * from finish();
rollback;
