-- A child row inserted WITHOUT org_id (or with a wrong one) ends up with its
-- parent's org_id, via the Part-2 BEFORE INSERT derive triggers.
-- UUID literals must be valid hex. Parents are seeded under replica so triggers
-- stay off during setup; child inserts run under DEFAULT so the derive trigger fires.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000de01', 'Der org', 'der-org');
INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('11111111-0000-0000-0000-00000000de01', 'theatre', 'musical', '00000000-0000-0000-0000-00000000de01');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('22222222-0000-0000-0000-00000000de01', 'Der artist', '00000000-0000-0000-0000-00000000de01');
SET session_replication_role = DEFAULT;

INSERT INTO public.show_dates (id, show_id, date, session_1)
VALUES ('33333333-0000-0000-0000-00000000de01', '11111111-0000-0000-0000-00000000de01', '2099-01-01', '19:00');
SELECT is(
  (SELECT org_id FROM public.show_dates WHERE id = '33333333-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'show_dates.org_id derived from shows');

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy)
VALUES ('44444444-0000-0000-0000-00000000de01', '33333333-0000-0000-0000-00000000de01',
        '22222222-0000-0000-0000-00000000de01', 'soft_booked', false);
SELECT is(
  (SELECT org_id FROM public.bookings WHERE id = '44444444-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'bookings.org_id derived from show_dates');

INSERT INTO public.blocked_dates (id, artist_id, date)
VALUES ('55555555-0000-0000-0000-00000000de01', '22222222-0000-0000-0000-00000000de01', '2099-01-02');
SELECT is(
  (SELECT org_id FROM public.blocked_dates WHERE id = '55555555-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'blocked_dates.org_id derived from artists');

INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000de02', 'Other', 'other-org');
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id)
VALUES ('66666666-0000-0000-0000-00000000de01', '33333333-0000-0000-0000-00000000de01',
        '22222222-0000-0000-0000-00000000de01', 'soft_booked', false,
        '00000000-0000-0000-0000-00000000de02');
SELECT is(
  (SELECT org_id FROM public.bookings WHERE id = '66666666-0000-0000-0000-00000000de01'),
  '00000000-0000-0000-0000-00000000de01'::uuid,
  'a wrong child org_id is overwritten by the parent org_id');

SELECT * FROM finish();
ROLLBACK;
