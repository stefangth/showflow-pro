-- Direct-booking orgs create bookings by INSERTing status='confirmed' with no
-- offer step (createBooking, confirmDirectly). notify_booking_transition() was
-- AFTER UPDATE only, so those artists got no in-app notification, ever
-- (Phase 3 gap 1). The INSERT branch closes it: INSERT as confirmed with a
-- linked artist -> one booking_confirmed notification; offer INSERTs
-- (suggested) and unlinked artists stay silent.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('db100000-0000-0000-0000-00000000000a','authenticated','authenticated','dbn-artist@test.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug)
  VALUES ('db100000-0000-0000-0000-000000000001', 'DBN Org', 'dbn-org');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('db100000-0000-0000-0000-000000000002', 'db100000-0000-0000-0000-000000000001', 'DBN', 'DBN: Show', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000002', '2026-08-01', '19:00');
-- a1 linked to the auth user, a2 and a3 unlinked
INSERT INTO public.artists (id, org_id, name, status, user_id)
  VALUES ('db100000-0000-0000-0000-000000000004', 'db100000-0000-0000-0000-000000000001', 'Linked Artist', 'active', 'db100000-0000-0000-0000-00000000000a');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('db100000-0000-0000-0000-000000000005', 'db100000-0000-0000-0000-000000000001', 'Unlinked Two', 'active');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('db100000-0000-0000-0000-000000000006', 'db100000-0000-0000-0000-000000000001', 'Unlinked Three', 'active');

-- 1) INSERT confirmed with a linked artist -> exactly one booking_confirmed
INSERT INTO public.bookings (id, show_date_id, artist_id, status)
  VALUES ('db100000-0000-0000-0000-000000000007', 'db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000004', 'confirmed');
SELECT is(
  (SELECT count(*) FROM public.notifications
    WHERE type = 'booking_confirmed'
      AND user_id = 'db100000-0000-0000-0000-00000000000a'
      AND related_entity_id = 'db100000-0000-0000-0000-000000000007'),
  1::bigint,
  'direct INSERT as confirmed notifies the linked artist');

-- 2) INSERT suggested (an offer) -> no new booking_confirmed row
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000005', 'suggested');
SELECT is(
  (SELECT count(*) FROM public.notifications WHERE type = 'booking_confirmed'),
  1::bigint,
  'offer INSERT (suggested) fires no confirmed notification');

-- 3) INSERT confirmed with an unlinked artist -> still no new row
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000006', 'confirmed');
SELECT is(
  (SELECT count(*) FROM public.notifications WHERE type = 'booking_confirmed'),
  1::bigint,
  'unlinked artist INSERT stays silent');

SELECT * FROM finish();
ROLLBACK;
