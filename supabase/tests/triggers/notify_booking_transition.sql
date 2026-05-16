-- Tests for public.notify_booking_transition() and notify_booking_transition_trigger.
--
-- The trigger writes exactly one audit-log row for each status transition and
-- fans notifications to producers/admins/artists for the lifecycle transitions
-- that should notify people.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

-- ────────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('81000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'notify-admin@test.com',     now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'notify-producer-a@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'notify-producer-b@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'notify-artist-a@test.com',   now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'notify-artist-b@test.com',   now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('81000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'notify-producer-c@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('81000000-0000-0000-0000-000000000001', 'admin'::app_role),
  ('81000000-0000-0000-0000-000000000002', 'producer'::app_role),
  ('81000000-0000-0000-0000-000000000003', 'producer'::app_role),
  ('81000000-0000-0000-0000-000000000004', 'artist'::app_role),
  ('81000000-0000-0000-0000-000000000005', 'artist'::app_role),
  ('81000000-0000-0000-0000-000000000006', 'producer'::app_role);

SET session_replication_role = DEFAULT;

INSERT INTO public.cities (id, name)
VALUES ('82000000-0000-0000-0000-000000000001', 'Notify Trigger City');

INSERT INTO public.shows (id, title, program, sub_program)
VALUES
  ('83000000-0000-0000-0000-000000000001', 'Assigned Notify Show', 'notify-program', 'assigned'),
  ('83000000-0000-0000-0000-000000000002', 'Fallback Notify Show', 'notify-program-no-match', 'fallback');

INSERT INTO public.show_dates (id, show_id, date, city_id, session_1)
VALUES
  ('84000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '2099-03-01', '82000000-0000-0000-0000-000000000001', '19:00'::time),
  ('84000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000002', '2099-03-02', '82000000-0000-0000-0000-000000000001', '19:00'::time),
  ('84000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000001', '2099-03-03', '82000000-0000-0000-0000-000000000001', '19:00'::time);

INSERT INTO public.artists (id, name, user_id) VALUES
  ('85000000-0000-0000-0000-000000000001', 'Notify Artist A', '81000000-0000-0000-0000-000000000004'),
  ('85000000-0000-0000-0000-000000000002', 'Notify Artist B', '81000000-0000-0000-0000-000000000005');

-- Duplicate ways to match producer A are intentional: the trigger must fan out
-- once per producer, not once per matching assignment row.
INSERT INTO public.show_assignments (producer_user_id, program, sub_program, city_id) VALUES
  ('81000000-0000-0000-0000-000000000002', 'notify-program', 'assigned', '82000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000002', 'notify-program', NULL, NULL),
  ('81000000-0000-0000-0000-000000000003', 'notify-program', 'assigned', NULL),
  ('81000000-0000-0000-0000-000000000006', 'different-notify-program', NULL, NULL);

INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy) VALUES
  ('86000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', 'suggested', false),
  ('86000000-0000-0000-0000-000000000002', '84000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', 'soft_booked', false),
  ('86000000-0000-0000-0000-000000000003', '84000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001', 'confirmed', false),
  ('86000000-0000-0000-0000-000000000004', '84000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000002', 'suggested', false),
  -- Separate assigned date avoids collateral auto-cancel from the confirmed-booking
  -- transition cases above; this isolates pure retry/no-op notification behavior.
  ('86000000-0000-0000-0000-000000000005', '84000000-0000-0000-0000-000000000003', '85000000-0000-0000-0000-000000000001', 'suggested', false);

-- ────────────────────────────────────────────────────────────────────────────
-- suggested → soft_booked: audit plus one notification per resolved producer.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = '86000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = '86000000-0000-0000-0000-000000000001'
     AND old_status = 'suggested'
     AND new_status = 'soft_booked'),
  1,
  'suggested → soft_booked writes exactly one audit row'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000001'
     AND type = 'booking_ready_to_confirm'),
  2,
  'suggested → soft_booked notifies each resolved producer once'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000001'
     AND user_id = '81000000-0000-0000-0000-000000000002'
     AND type = 'booking_ready_to_confirm'),
  1,
  'duplicate assignment matches do not duplicate a producer notification'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000001'
     AND user_id = '81000000-0000-0000-0000-000000000001'),
  0,
  'admin fallback does not fire when a producer assignment resolves'
);

-- ────────────────────────────────────────────────────────────────────────────
-- soft_booked → confirmed: audit plus artist notification only.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'confirmed'
WHERE id = '86000000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = '86000000-0000-0000-0000-000000000002'
     AND old_status = 'soft_booked'
     AND new_status = 'confirmed'),
  1,
  'soft_booked → confirmed writes exactly one audit row'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000002'
     AND user_id = '81000000-0000-0000-0000-000000000004'
     AND type = 'booking_confirmed'),
  1,
  'soft_booked → confirmed notifies the artist once'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000002'
     AND type = 'booking_ready_to_confirm'),
  0,
  'soft_booked → confirmed does not notify producers'
);

-- ────────────────────────────────────────────────────────────────────────────
-- confirmed → cancelled: audit only, no notification fan-out.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'cancelled'
WHERE id = '86000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = '86000000-0000-0000-0000-000000000003'
     AND old_status = 'confirmed'
     AND new_status = 'cancelled'),
  1,
  'confirmed → cancelled writes exactly one audit row'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000003'),
  0,
  'confirmed → cancelled does not fan out notifications'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Fallback: no producer assignment means admins are notified.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = '86000000-0000-0000-0000-000000000004';

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000004'
     AND user_id = '81000000-0000-0000-0000-000000000001'
     AND type = 'booking_ready_to_confirm'),
  1,
  'admin fallback fires once when no producer assignment resolves'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000004'
     AND user_id IN (
       '81000000-0000-0000-0000-000000000002',
       '81000000-0000-0000-0000-000000000003',
       '81000000-0000-0000-0000-000000000006'
     )),
  0,
  'fallback path does not notify unrelated producers'
);

-- ────────────────────────────────────────────────────────────────────────────
-- No-op updates must not create duplicate audits or notifications.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = '86000000-0000-0000-0000-000000000005';

UPDATE public.bookings
SET notes = 'retry/no status transition'
WHERE id = '86000000-0000-0000-0000-000000000005';

UPDATE public.bookings
SET status = 'soft_booked'
WHERE id = '86000000-0000-0000-0000-000000000005';

SELECT is(
  (SELECT count(*)::int FROM public.booking_audit_log
   WHERE booking_id = '86000000-0000-0000-0000-000000000005'),
  1,
  'retry/no-op updates do not duplicate audit rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE related_entity_id = '86000000-0000-0000-0000-000000000005'
     AND type = 'booking_ready_to_confirm'),
  2,
  'retry/no-op updates do not duplicate transition notifications'
);

SELECT * FROM finish();
ROLLBACK;
