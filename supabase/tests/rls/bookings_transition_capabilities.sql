-- pgTAP: transition-gated write RLS on bookings (Plan 3, Phase 1.9c).
-- Producer writes that land 'confirmed' require producer_can_confirm_bookings;
-- suggest/soft-book/cancel and all reads are unaffected; admin always.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
  ('11111111-0009-4001-8001-000000000001','authenticated','authenticated','bk-admin@t.com',now(),now()),
  ('11111111-0009-4001-8001-000000000002','authenticated','authenticated','bk-prod@t.com',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES ('22222222-0009-4001-8001-000000000001','BkOrg','bk-cap-org');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('22222222-0009-4001-8001-000000000001','11111111-0009-4001-8001-000000000001','admin'),
  ('22222222-0009-4001-8001-000000000001','11111111-0009-4001-8001-000000000002','producer');
INSERT INTO public.shows (id, org_id, main_cast_slots, understudy_slots) VALUES ('33333333-0009-4001-8001-000000000001','22222222-0009-4001-8001-000000000001',20,5);
INSERT INTO public.show_dates (id, show_id, date, org_id) VALUES ('44444444-0009-4001-8001-000000000001','33333333-0009-4001-8001-000000000001','2026-09-01','22222222-0009-4001-8001-000000000001');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('66666666-0009-4001-8001-000000000001','A1','22222222-0009-4001-8001-000000000001'),
  ('66666666-0009-4001-8001-000000000002','A2','22222222-0009-4001-8001-000000000001'),
  ('66666666-0009-4001-8001-000000000003','A3','22222222-0009-4001-8001-000000000001'),
  ('66666666-0009-4001-8001-000000000004','A4','22222222-0009-4001-8001-000000000001'),
  ('66666666-0009-4001-8001-000000000005','A5','22222222-0009-4001-8001-000000000001');
SET session_replication_role = DEFAULT;

-- Producer (confirm_bookings on by default).
SELECT set_config('request.jwt.claims','{"sub":"11111111-0009-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ insert into public.bookings (show_date_id, artist_id, org_id, status) values ('44444444-0009-4001-8001-000000000001','66666666-0009-4001-8001-000000000001','22222222-0009-4001-8001-000000000001','confirmed') $$, 'producer INSERT confirmed allowed when confirm on');
SELECT lives_ok($$ insert into public.bookings (show_date_id, artist_id, org_id, status) values ('44444444-0009-4001-8001-000000000001','66666666-0009-4001-8001-000000000002','22222222-0009-4001-8001-000000000001','soft_booked') $$, 'producer INSERT soft_booked allowed');
UPDATE public.bookings SET status='confirmed' WHERE artist_id='66666666-0009-4001-8001-000000000002';
SELECT is((SELECT status::text FROM public.bookings WHERE artist_id='66666666-0009-4001-8001-000000000002'), 'confirmed', 'producer UPDATE soft->confirmed applied when confirm on');
SELECT isnt_empty($$ select 1 from public.bookings where org_id='22222222-0009-4001-8001-000000000001' $$, 'producer SELECT bookings always works');
-- setup a soft_booked for A4 (used in the off-phase confirm-denied test)
INSERT INTO public.bookings (show_date_id, artist_id, org_id, status) VALUES ('44444444-0009-4001-8001-000000000001','66666666-0009-4001-8001-000000000004','22222222-0009-4001-8001-000000000001','soft_booked');
RESET ROLE;

-- Disable confirm_bookings.
SET session_replication_role = replica;
INSERT INTO public.org_capabilities (org_id, capability, enabled) VALUES ('22222222-0009-4001-8001-000000000001','producer_can_confirm_bookings',false);
SET session_replication_role = DEFAULT;

SELECT set_config('request.jwt.claims','{"sub":"11111111-0009-4001-8001-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ insert into public.bookings (show_date_id, artist_id, org_id, status) values ('44444444-0009-4001-8001-000000000001','66666666-0009-4001-8001-000000000003','22222222-0009-4001-8001-000000000001','confirmed') $$, '42501', NULL, 'producer INSERT confirmed denied when confirm off');
-- Confirm via UPDATE trips WITH CHECK (raises 42501), unlike the USING-gated tables above.
SELECT throws_ok($$ update public.bookings set status='confirmed' where artist_id='66666666-0009-4001-8001-000000000004' $$, '42501', NULL, 'producer UPDATE soft->confirmed denied when confirm off');
UPDATE public.bookings SET status='cancelled' WHERE artist_id='66666666-0009-4001-8001-000000000004';
SELECT is((SELECT status::text FROM public.bookings WHERE artist_id='66666666-0009-4001-8001-000000000004'), 'cancelled', 'producer cancel always allowed (not gated)');
RESET ROLE;

-- Admin always.
SELECT set_config('request.jwt.claims','{"sub":"11111111-0009-4001-8001-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ insert into public.bookings (show_date_id, artist_id, org_id, status) values ('44444444-0009-4001-8001-000000000001','66666666-0009-4001-8001-000000000005','22222222-0009-4001-8001-000000000001','confirmed') $$, 'admin INSERT confirmed always allowed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
