-- Per-org slot resolution: org A overrides sub_program_slots_defaults; org B inherits the
-- platform default. The SAME (program, sub_program) + one confirmed main booking yields
-- DIFFERENT status per org because each show_date resolves its own org's effective caps.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','Slot A','slot-a'),
  ('00000000-0000-0000-0000-00000000b000','Slot B','slot-b');

-- platform default: theatre/musical needs main_cast=1 (one confirmed main ⇒ fully_filled)
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'sub_program_slots_defaults', '{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb),
-- org A override: needs main_cast=2 (one confirmed main ⇒ only partially_filled)
  ('00000000-0000-0000-0000-00000000a000','sub_program_slots_defaults','{"theatre":{"musical":{"main_cast":2,"understudies":0}}}'::jsonb);

INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('cccccccc-aa00-0000-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000a000'),
  ('cccccccc-bb00-0000-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000b000');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('bbbbbbbb-aa00-0000-0000-000000000000','A artist','00000000-0000-0000-0000-00000000a000'),
  ('bbbbbbbb-bb00-0000-0000-000000000000','B artist','00000000-0000-0000-0000-00000000b000');
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('dddddddd-aa00-0000-0000-000000000000','cccccccc-aa00-0000-0000-000000000000','2099-09-01','19:00','00000000-0000-0000-0000-00000000a000'),
  ('dddddddd-bb00-0000-0000-000000000000','cccccccc-bb00-0000-0000-000000000000','2099-09-01','19:00','00000000-0000-0000-0000-00000000b000');
SET session_replication_role = DEFAULT;

-- one confirmed main booking on each org's date (bookings trigger recomputes status)
INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('dddddddd-aa00-0000-0000-000000000000','bbbbbbbb-aa00-0000-0000-000000000000','confirmed',false,'00000000-0000-0000-0000-00000000a000'),
  ('dddddddd-bb00-0000-0000-000000000000','bbbbbbbb-bb00-0000-0000-000000000000','confirmed',false,'00000000-0000-0000-0000-00000000b000');

SELECT is((SELECT status::text FROM public.show_dates WHERE id='dddddddd-bb00-0000-0000-000000000000'),
          'fully_filled', 'org B (platform default cap=1) → fully_filled');
SELECT is((SELECT status::text FROM public.show_dates WHERE id='dddddddd-aa00-0000-0000-000000000000'),
          'partially_filled', 'org A (override cap=2) → partially_filled with one main');

-- updating org A's override to cap=1 cascades to A's date only → fully_filled
UPDATE public.app_settings
  SET value='{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb
  WHERE org_id='00000000-0000-0000-0000-00000000a000' AND key='sub_program_slots_defaults';
SELECT is((SELECT status::text FROM public.show_dates WHERE id='dddddddd-aa00-0000-0000-000000000000'),
          'fully_filled', 'lowering org A override recomputes A''s date to fully_filled');

SELECT * FROM finish();
ROLLBACK;
