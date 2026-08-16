-- Demo mode phase 2: scene + sim-clock columns on demo_state.
--
-- Persists which narrative scene a demo org is currently on and the
-- simulated "now" the demo provider presents in place of the real clock,
-- so a presenter can leave a demo and come back mid-script. All three are
-- nullable: a demo org with no active script simply has none of these set.

alter table public.demo_state
  add column if not exists sim_now timestamptz,
  add column if not exists current_scene_id text,
  add column if not exists script_id text;
