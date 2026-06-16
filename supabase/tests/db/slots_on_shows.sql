-- Slot capacity lives on shows.main_cast_slots / understudy_slots; status is computed from them.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-slots');
INSERT INTO public.shows (id, org_id, program, sub_program, status, main_cast_slots, understudy_slots)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active', 1, 0);
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Artist One', 'active');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'BOL', 'BOL: PP', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', '2026-07-02', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b', '11111111-1111-1111-1111-111111111111', 'Artist Two', 'active');

-- 1) configured date with no bookings is 'open'
SELECT is((SELECT status FROM public.show_dates WHERE id = '33333333-3333-3333-3333-333333333333'),
          'open'::show_date_status, 'configured date, no bookings -> open');
-- 2) confirming the single main slot -> fully_filled
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'confirmed');
SELECT is((SELECT status FROM public.show_dates WHERE id = '33333333-3333-3333-3333-333333333333'),
          'fully_filled'::show_date_status, '1/1 main confirmed -> fully_filled');
-- 3) NULL-slot (unconfigured) date never reaches fully_filled
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('99999999-9999-9999-9999-999999999999', '4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b', 'confirmed');
SELECT is((SELECT status FROM public.show_dates WHERE id = '99999999-9999-9999-9999-999999999999'),
          'partially_filled'::show_date_status, 'NULL slots -> partially_filled, never fully_filled');
-- 4) configuring slots on the show recomputes its dates
UPDATE public.shows SET main_cast_slots = 1, understudy_slots = 0
  WHERE id = '88888888-8888-8888-8888-888888888888';
SELECT is((SELECT status FROM public.show_dates WHERE id = '99999999-9999-9999-9999-999999999999'),
          'fully_filled'::show_date_status, 'setting slots on the show recomputes its dates -> fully_filled');
-- 5) the app_settings slot-recompute trigger is gone
SELECT is((SELECT count(*) FROM pg_trigger WHERE tgname = 'sync_show_dates_on_settings_update_trigger'),
          0::bigint, 'app_settings slot-recompute trigger dropped');

SELECT * FROM finish();
ROLLBACK;
