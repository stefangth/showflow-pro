-- RLS tests for public.chats, public.chat_messages, and the
-- public.is_chat_participant() SECURITY DEFINER helper.
--
-- Policies under test (source migration: 20260421170151):
--   is_chat_participant():   admin/producer always; artist only with
--                            soft_booked or confirmed booking on that date.
--   "Participants can view chats"    — SELECT on chats
--   "Participants can view messages" — SELECT on chat_messages
--   "Participants can post messages" — INSERT on chat_messages
--
-- Note: chat archive (read-only after CHAT_ARCHIVE_DAYS) is enforced
-- client-side via app.config.ts, not by a DB policy — no DB-level test here.
--
-- UUID legend (all IDs rolled back at the end):
--   aaaaaaaa-aaaa-0001-…  admin user
--   aaaaaaaa-aaaa-0002-…  producer user
--   aaaaaaaa-aaaa-0003-…  artist A user  (soft_booked → participant)
--   aaaaaaaa-aaaa-0004-…  artist B user  (suggested only → not a participant)
--   bbbbbbbb-bbbb-0001-…  artist A profile
--   bbbbbbbb-bbbb-0002-…  artist B profile
--   cccccccc-cccc-0001-…  show
--   dddddddd-dddd-0001-…  show_date
--   eeeeeeee-eeee-0001-…  booking: artist A, soft_booked
--   eeeeeeee-eeee-0002-…  booking: artist B, suggested
--   ffffffff-ffff-0001-…  chat
--   ffffffff-ffff-0002-…  chat_message (setup seed)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(14);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixture setup
-- ────────────────────────────────────────────────────────────────────────────

SET session_replication_role = replica;

-- aud and role are NOT NULL in GoTrue's local Docker schema; always provide them.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000', 'authenticated', 'authenticated', 'rls-ch-admin@test.com',    now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0002-0000-000000000000', 'authenticated', 'authenticated', 'rls-ch-producer@test.com', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0003-0000-000000000000', 'authenticated', 'authenticated', 'rls-ch-artista@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now()),
  ('aaaaaaaa-aaaa-0004-0000-000000000000', 'authenticated', 'authenticated', 'rls-ch-artistb@test.com',  now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now());


-- Phase 1B: is_chat_participant now checks has_org_role (no global fallback), so
-- staff need bootstrap-org memberships. Domain rows below default to the bootstrap
-- org, so the chat's show_date.org_id matches.
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0002-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0003-0000-000000000000','artist'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-aaaa-0004-0000-000000000000','artist');

INSERT INTO public.artists (id, name, user_id, org_id) VALUES
  ('bbbbbbbb-bbbb-0001-0000-000000000000', 'Chat Artist A', 'aaaaaaaa-aaaa-0003-0000-000000000000', '00000000-0000-0000-0000-00000000b007'),
  ('bbbbbbbb-bbbb-0002-0000-000000000000', 'Chat Artist B', 'aaaaaaaa-aaaa-0004-0000-000000000000', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.shows (id, program, sub_program, org_id)
VALUES ('cccccccc-cccc-0001-0000-000000000000', 'theatre', 'musical', '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.show_dates (id, show_id, date, session_1, org_id)
VALUES ('dddddddd-dddd-0001-0000-000000000000', 'cccccccc-cccc-0001-0000-000000000000', '2099-02-01', '20:00'::time, '00000000-0000-0000-0000-00000000b007');

-- Artist A is soft_booked main-cast → participant.
-- Artist B is suggested understudy → not a participant.
-- is_understudy differs deliberately: slot_fill_auto_cancel_trigger only cancels
-- bookings with the SAME is_understudy value, so confirming artist B's understudy
-- slot (in tests 5-7) cannot cancel artist A's main-cast booking.
INSERT INTO public.bookings (id, show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('eeeeeeee-eeee-0001-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0001-0000-000000000000', 'soft_booked'::booking_status, false, '00000000-0000-0000-0000-00000000b007'),
  ('eeeeeeee-eeee-0002-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', 'bbbbbbbb-bbbb-0002-0000-000000000000', 'suggested'::booking_status, true, '00000000-0000-0000-0000-00000000b007');

INSERT INTO public.chats (id, show_date_id, org_id)
VALUES ('ffffffff-ffff-0001-0000-000000000000', 'dddddddd-dddd-0001-0000-000000000000', '00000000-0000-0000-0000-00000000b007');

-- Seed message authored by admin (user_id has no FK on chat_messages)
INSERT INTO public.chat_messages (id, chat_id, user_id, body, org_id)
VALUES ('ffffffff-ffff-0002-0000-000000000000', 'ffffffff-ffff-0001-0000-000000000000', 'aaaaaaaa-aaaa-0001-0000-000000000000', 'Hello from admin', '00000000-0000-0000-0000-00000000b007');

SET session_replication_role = DEFAULT;

-- ────────────────────────────────────────────────────────────────────────────
-- is_chat_participant() function — called as superuser, testing the logic
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Admin is always a participant
SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0001-0000-000000000000'::uuid
  ),
  true,
  'is_chat_participant: admin is always a participant'
);

-- 2. Producer is always a participant
SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0002-0000-000000000000'::uuid
  ),
  true,
  'is_chat_participant: producer is always a participant'
);

-- 3. Artist A with soft_booked booking is a participant
SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0003-0000-000000000000'::uuid
  ),
  true,
  'is_chat_participant: artist with soft_booked booking is a participant'
);

-- 4. Artist B with only suggested booking is NOT a participant
SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0004-0000-000000000000'::uuid
  ),
  false,
  'is_chat_participant: artist with only suggested booking is not a participant'
);

-- 5. Promote artist B to confirmed — now a participant
UPDATE public.bookings
SET status = 'confirmed'
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0004-0000-000000000000'::uuid
  ),
  true,
  'is_chat_participant: artist with confirmed booking is a participant'
);

-- 6. Revert artist B back to suggested (no status=suggested → soft_booked trigger
--    on direct superuser UPDATE so we can just set it directly)
UPDATE public.bookings
SET status = 'suggested'
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0004-0000-000000000000'::uuid
  ),
  false,
  'is_chat_participant: reverted to suggested means not a participant again'
);

-- 7. Artist with cancelled booking is NOT a participant
UPDATE public.bookings
SET status = 'cancelled'
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

SELECT is(
  public.is_chat_participant(
    'ffffffff-ffff-0001-0000-000000000000'::uuid,
    'aaaaaaaa-aaaa-0004-0000-000000000000'::uuid
  ),
  false,
  'is_chat_participant: artist with cancelled booking is not a participant'
);

-- Restore for RLS tests below
UPDATE public.bookings
SET status = 'suggested'
WHERE id = 'eeeeeeee-eeee-0002-0000-000000000000';

-- ────────────────────────────────────────────────────────────────────────────
-- chats SELECT via RLS (uses is_chat_participant internally)
-- ────────────────────────────────────────────────────────────────────────────

-- 8. Admin can SELECT from chats
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chats
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'admin can SELECT from chats'
);

RESET ROLE;

-- 9. Producer can SELECT from chats
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0002-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chats
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'producer can SELECT from chats'
);

RESET ROLE;

-- 10. Artist A (soft_booked) can SELECT from chats
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chats
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  1,
  'artist A (soft_booked) can SELECT from chats'
);

RESET ROLE;

-- 11. Artist B (suggested only) cannot SELECT from chats
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chats
   WHERE id = 'ffffffff-ffff-0001-0000-000000000000'),
  0,
  'artist B (suggested only) cannot SELECT from chats'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- chat_messages SELECT and INSERT via RLS
-- ────────────────────────────────────────────────────────────────────────────

-- 12. Admin can SELECT from chat_messages
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.chat_messages
   WHERE id = 'ffffffff-ffff-0002-0000-000000000000'),
  1,
  'admin can SELECT from chat_messages'
);

RESET ROLE;

-- 13. Artist A (participant) can INSERT a chat message
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0003-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.chat_messages (chat_id, user_id, body, org_id)
    VALUES (
      'ffffffff-ffff-0001-0000-000000000000',
      'aaaaaaaa-aaaa-0003-0000-000000000000',
      'Artist A says hello',
      '00000000-0000-0000-0000-00000000b007'
    )$$,
  'artist A (participant) can INSERT a chat message'
);

RESET ROLE;

-- 14. Artist B (not a participant) cannot INSERT a chat message
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-0004-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.chat_messages (chat_id, user_id, body, org_id)
    VALUES (
      'ffffffff-ffff-0001-0000-000000000000',
      'aaaaaaaa-aaaa-0004-0000-000000000000',
      'Artist B tries to post',
      '00000000-0000-0000-0000-00000000b007'
    )$$,
  null, null,
  'artist B (not a participant) cannot INSERT a chat message'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
