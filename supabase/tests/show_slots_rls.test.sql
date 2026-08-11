-- show_slots + show_slot_required_skills: shape, RLS, FK delete semantics, and the
-- admin/producer write gate (an artist cannot insert a slot).
--   11111111-…-0001 admin   11111111-…-0002 producer   11111111-…-0003 artist
--   22222222-…-0001 org
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('11111111-0001-4001-8001-000000000001','authenticated','authenticated','slots-admin@t.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('11111111-0001-4001-8001-000000000002','authenticated','authenticated','slots-producer@t.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('11111111-0001-4001-8001-000000000003','authenticated','authenticated','slots-artist@t.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-0001-4001-8001-000000000001','Show Slots Org','show-slots-org');

INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0001-4001-8001-000000000001','11111111-0001-4001-8001-000000000001','admin'),
  ('22222222-0001-4001-8001-000000000001','11111111-0001-4001-8001-000000000002','producer'),
  ('22222222-0001-4001-8001-000000000001','11111111-0001-4001-8001-000000000003','artist');

INSERT INTO public.shows (id, org_id, program) VALUES
  ('33333333-0001-4001-8001-000000000001','22222222-0001-4001-8001-000000000001','Show Slots Test Show');

INSERT INTO public.skills (id, org_id, name) VALUES
  ('44444444-0001-4001-8001-000000000001','22222222-0001-4001-8001-000000000001','Vocals');
SET session_replication_role = DEFAULT;

-- Insert OUTSIDE replica mode (as the postgres superuser, which bypasses RLS but not
-- ordinary triggers) so the BEFORE INSERT derive-org trigger actually fires -- that is
-- exactly what assertion 5 below checks.
INSERT INTO public.show_slots (id, show_id, name, slot_count, kind, sort_order) VALUES
  ('55555555-0001-4001-8001-000000000001','33333333-0001-4001-8001-000000000001','Main cast',3,'main',0);

-- 1-2. Shape: both tables exist.
SELECT has_table('public', 'show_slots', 'show_slots exists');
SELECT has_table('public', 'show_slot_required_skills', 'show_slot_required_skills exists');

-- 3-4. RLS is enabled on both.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.show_slots'::regclass),
  'RLS is enabled on show_slots');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.show_slot_required_skills'::regclass),
  'RLS is enabled on show_slot_required_skills');

-- 5. org_id derivation: the row inserted above with no org_id given picked it up
-- from its parent show via the BEFORE INSERT trigger.
SELECT is(
  (SELECT org_id::text FROM public.show_slots WHERE id = '55555555-0001-4001-8001-000000000001'),
  '22222222-0001-4001-8001-000000000001',
  'show_slots.org_id is derived from the parent show');

-- 6-8. FK delete semantics: skill_id RESTRICT, slot_id and show_id CASCADE.
SELECT is(
  (SELECT confdeltype FROM pg_constraint WHERE conname = 'show_slot_required_skills_skill_id_fkey'),
  'r', 'show_slot_required_skills.skill_id FK is ON DELETE RESTRICT');
SELECT is(
  (SELECT confdeltype FROM pg_constraint WHERE conname = 'show_slot_required_skills_slot_id_fkey'),
  'c', 'show_slot_required_skills.slot_id FK is ON DELETE CASCADE');
SELECT is(
  (SELECT confdeltype FROM pg_constraint WHERE conname = 'show_slots_show_id_fkey'),
  'c', 'show_slots.show_id FK is ON DELETE CASCADE');

-- 9. Same-org guard: a skill from a different org cannot be attached to this slot.
SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('22222222-0001-4001-8001-000000000002','Other Org','show-slots-other-org');
INSERT INTO public.skills (id, org_id, name) VALUES
  ('44444444-0001-4001-8001-000000000002','22222222-0001-4001-8001-000000000002','Stage combat');
SET session_replication_role = DEFAULT;
SELECT throws_ok(
  $$ INSERT INTO public.show_slot_required_skills (slot_id, skill_id)
     VALUES ('55555555-0001-4001-8001-000000000001','44444444-0001-4001-8001-000000000002') $$,
  NULL, 'required skill must belong to the same organization',
  'a cross-org skill cannot be attached to a slot');

-- 10. Write gate: an artist cannot insert a slot.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0001-4001-8001-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.show_slots (show_id, name, slot_count, kind)
     VALUES ('33333333-0001-4001-8001-000000000001','Ensemble',2,'main') $$,
  '42501', NULL, 'an artist cannot insert a show slot');
RESET ROLE;

-- 11. Producer CAN insert a slot (role gate is admin-or-producer, not admin-only).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0001-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ INSERT INTO public.show_slots (show_id, name, slot_count, kind, sort_order)
     VALUES ('33333333-0001-4001-8001-000000000001','Understudy',2,'understudy',1) $$,
  'a producer can insert a show slot');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
