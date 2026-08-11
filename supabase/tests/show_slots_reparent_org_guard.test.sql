-- Reparent guard (20260812180000): a slot's org_id is re-derived on any UPDATE of
-- its parent FK, and a reparent that would cross organizations is rejected. Without
-- this, org_id -- the column both the write-gate and the RESTRICTIVE org_isolation
-- policies authorize on -- kept its old value while the FK pointed at a foreign show,
-- and the recompute trigger rewrote that foreign show's caches.
--   a0000000-… org A   b0000000-… org B
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

-- Fixtures seeded with triggers off (as in show_slots_rls.test.sql); the slot and
-- required-skill rows below are then inserted with triggers ON so org_id is derived.
SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('a0000000-0000-4000-8000-000000000001','Reparent Org A','reparent-org-a'),
  ('b0000000-0000-4000-8000-000000000001','Reparent Org B','reparent-org-b');
INSERT INTO public.shows (id, org_id, program) VALUES
  ('c0000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-000000000001','Show A'),
  ('c0000000-0000-4000-8000-00000000000b','b0000000-0000-4000-8000-000000000001','Show B');
INSERT INTO public.skills (id, org_id, name) VALUES
  ('e0000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-000000000001','Vocals A');
SET session_replication_role = DEFAULT;

-- Slot A (org A) and slot B (org B); org_id derived from the parent show.
INSERT INTO public.show_slots (id, show_id, name, slot_count, kind, sort_order) VALUES
  ('d0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-00000000000a','Main A',3,'main',0),
  ('d0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000b','Main B',3,'main',0);
-- Required-skill row on slot A (org A).
INSERT INTO public.show_slot_required_skills (id, slot_id, skill_id) VALUES
  ('f0000000-0000-4000-8000-00000000000a','d0000000-0000-4000-8000-00000000000a','e0000000-0000-4000-8000-00000000000a');

-- 1. Reparenting a slot to a show in another org is rejected.
SELECT throws_like(
  $$ UPDATE public.show_slots SET show_id = 'c0000000-0000-4000-8000-00000000000b'
     WHERE id = 'd0000000-0000-4000-8000-00000000000a' $$,
  '%cannot be reparented across organizations%',
  'a show_slot cannot be reparented into another org');

-- 2. The failed reparent left org_id untouched (the statement rolled back).
SELECT is(
  (SELECT org_id::text FROM public.show_slots WHERE id = 'd0000000-0000-4000-8000-00000000000a'),
  'a0000000-0000-4000-8000-000000000001',
  'show_slots.org_id is unchanged after a rejected reparent');

-- 3. A same-org update of other columns still works (the guard only blocks reparents).
SELECT lives_ok(
  $$ UPDATE public.show_slots SET name = 'Main A (renamed)', slot_count = 4
     WHERE id = 'd0000000-0000-4000-8000-00000000000a' $$,
  'a same-org column update on a show_slot is allowed');

-- 4. Reparenting a required-skill row to a slot in another org is rejected.
SELECT throws_like(
  $$ UPDATE public.show_slot_required_skills SET slot_id = 'd0000000-0000-4000-8000-00000000000b'
     WHERE id = 'f0000000-0000-4000-8000-00000000000a' $$,
  '%cannot be reparented across organizations%',
  'a show_slot_required_skill cannot be reparented into another org');

-- 5. Its org_id is likewise untouched.
SELECT is(
  (SELECT org_id::text FROM public.show_slot_required_skills WHERE id = 'f0000000-0000-4000-8000-00000000000a'),
  'a0000000-0000-4000-8000-000000000001',
  'show_slot_required_skills.org_id is unchanged after a rejected reparent');

SELECT * FROM finish();
ROLLBACK;
