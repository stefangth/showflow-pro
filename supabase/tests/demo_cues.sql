begin;
select plan(28);

-- Scene + sim-clock columns (Phase 2) exist on demo_state.
select has_column('public', 'demo_state', 'sim_now', 'demo_state.sim_now exists');
select has_column('public', 'demo_state', 'current_scene_id', 'demo_state.current_scene_id exists');
select has_column('public', 'demo_state', 'script_id', 'demo_state.script_id exists');

-- Guard: refuses a non-demo org (the bootstrap org always exists, is_demo = false).
select throws_ok(
  $$ select public.run_demo_cue('00000000-0000-0000-0000-00000000b007', 'drop_notifications', null) $$,
  'P0001',
  'run_demo_cue refused: 00000000-0000-0000-0000-00000000b007 is not a demo org',
  'run_demo_cue refuses non-demo org'
);

-- Set up a demo org and seed it (the scene-03 story: 1 suggested, 2 holds due
-- today 17:00, one date at 1-of-3 confirmed main, one main_cast_slots=3 show).
insert into public.organizations (id, name, slug, status, is_demo)
values ('5eedc0e0-0000-0000-0000-0000000000c0', 'Cue Co', 'cue-co', 'active', true)
on conflict (id) do update set is_demo = true;
select public.seed_demo_org('5eedc0e0-0000-0000-0000-0000000000c0', 'full', null);

-- artist_accepts_offer: promotes the one seeded 'suggested' booking to
-- soft_booked. Count of soft_booked must not decrease; suggested reaches 0.
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'artist_accepts_offer', null) $$,
  'artist_accepts_offer runs'
);
select is(
  (select count(*)::int from public.bookings where org_id = '5eedc0e0-0000-0000-0000-0000000000c0' and status = 'suggested'),
  0, 'artist_accepts_offer: no suggested bookings remain'
);
select is(
  (select count(*)::int from public.bookings where org_id = '5eedc0e0-0000-0000-0000-0000000000c0' and status = 'soft_booked'),
  3, 'artist_accepts_offer: soft_booked count grows to 3 (2 holds + 1 promoted)'
);

-- Idempotent: running again with nothing left 'suggested' is a no-op.
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'artist_accepts_offer', null) $$,
  'artist_accepts_offer idempotent'
);
select is(
  (select count(*)::int from public.bookings where org_id = '5eedc0e0-0000-0000-0000-0000000000c0' and status = 'suggested'),
  0, 'artist_accepts_offer idempotent: still no suggested bookings'
);
select is(
  (select count(*)::int from public.bookings where org_id = '5eedc0e0-0000-0000-0000-0000000000c0' and status = 'soft_booked'),
  3, 'artist_accepts_offer idempotent: soft_booked count unchanged at 3'
);

-- run_clock_to_1700: the two seeded holds (offer_expires_at = today 17:00,
-- status soft_booked) expire to cancelled. The freshly-promoted booking from
-- artist_accepts_offer has no offer_expires_at, so it is untouched.
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'run_clock_to_1700', null) $$,
  'run_clock_to_1700 runs'
);
select is(
  (select count(*)::int from public.bookings b join public.show_dates d on d.id = b.show_date_id
    where d.org_id = '5eedc0e0-0000-0000-0000-0000000000c0' and b.status = 'soft_booked'
      and b.offer_expires_at is not null and b.offer_expires_at <= now()),
  0, 'run_clock_to_1700: expired holds no longer soft_booked'
);
select is(
  (select count(*)::int from public.bookings where org_id = '5eedc0e0-0000-0000-0000-0000000000c0'
    and status = 'cancelled' and cancellation_reason = 'Offer expired'),
  2, 'run_clock_to_1700: exactly the 2 seeded holds are cancelled as expired'
);

-- Idempotent: already-cancelled rows are untouched, no error, no double-apply.
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'run_clock_to_1700', null) $$,
  'run_clock_to_1700 idempotent'
);
select is(
  (select count(*)::int from public.bookings where org_id = '5eedc0e0-0000-0000-0000-0000000000c0'
    and status = 'cancelled' and cancellation_reason = 'Offer expired'),
  2, 'run_clock_to_1700 idempotent: still exactly 2 expired-cancelled'
);

-- drop_notifications: inserts 3 unread notifications of type demo_cue for the
-- given actor. Idempotent: re-running replaces rather than duplicating them.
-- notifications.user_id FKs to auth.users, so the actor needs a real row.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'cue-actor@demo.invalid', now(), '{"provider":"email"}', '{}', now(), now());

select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'drop_notifications', '11111111-1111-1111-1111-111111111111') $$,
  'drop_notifications runs'
);
select is(
  (select count(*)::int from public.notifications where org_id = '5eedc0e0-0000-0000-0000-0000000000c0'
    and user_id = '11111111-1111-1111-1111-111111111111' and type = 'demo_cue' and read = false),
  3, 'drop_notifications: 3 unread demo_cue notifications for the actor'
);
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'drop_notifications', '11111111-1111-1111-1111-111111111111') $$,
  'drop_notifications idempotent'
);
select is(
  (select count(*)::int from public.notifications where org_id = '5eedc0e0-0000-0000-0000-0000000000c0'
    and user_id = '11111111-1111-1111-1111-111111111111' and type = 'demo_cue'),
  3, 'drop_notifications idempotent: still exactly 3 (replaced, not duplicated)'
);

-- fill_date: confirm the remaining main + understudy slots on the date that
-- already has one confirmed non-understudy booking (partially_filled), so it
-- reaches fully_filled synchronously. (The dispatch_hire_order_drafts trigger
-- this fires does an ASYNC net.http_post -- we do not assert a draft hire
-- order here, only the synchronous show_dates status transition.)
create temp table cue_fill_target as
select d.id from public.show_dates d
where d.org_id = '5eedc0e0-0000-0000-0000-0000000000c0' and d.status = 'partially_filled'
  and exists (
    select 1 from public.bookings b
    where b.show_date_id = d.id and b.status = 'confirmed' and b.is_understudy = false
  )
order by d.date limit 1;

select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'fill_date', null) $$,
  'fill_date runs'
);
select is(
  (select status::text from public.show_dates where id = (select id from cue_fill_target)),
  'fully_filled', 'fill_date: target date reaches fully_filled'
);
select is(
  (select count(*)::int from public.bookings where show_date_id = (select id from cue_fill_target)
    and status = 'confirmed' and is_understudy = false),
  3, 'fill_date: 3 confirmed non-understudy bookings (main_cast_slots)'
);
select is(
  (select count(*)::int from public.bookings where show_date_id = (select id from cue_fill_target)
    and status = 'confirmed' and is_understudy = true),
  1, 'fill_date: 1 confirmed understudy booking'
);

-- Idempotent: the date is already fully_filled, so a second run is a no-op
-- (no error, no overshoot past main_cast_slots).
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'fill_date', null) $$,
  'fill_date idempotent'
);
select is(
  (select count(*)::int from public.bookings where show_date_id = (select id from cue_fill_target)
    and status = 'confirmed' and is_understudy = false),
  3, 'fill_date idempotent: still exactly 3 confirmed non-understudy bookings'
);

-- advance_clock: bumps demo_state.sim_now by 1 day from whatever
-- run_clock_to_1700 left it at (today 17:00).
select lives_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'advance_clock', null) $$,
  'advance_clock runs'
);
select is(
  (select sim_now from public.demo_state where org_id = '5eedc0e0-0000-0000-0000-0000000000c0'),
  (current_date + interval '17 hours' + interval '1 day')::timestamptz,
  'advance_clock: sim_now advances one day past run_clock_to_1700''s 17:00'
);

-- Unknown cue raises.
select throws_ok(
  $$ select public.run_demo_cue('5eedc0e0-0000-0000-0000-0000000000c0', 'not_a_real_cue', null) $$,
  'P0001',
  'run_demo_cue: unknown cue not_a_real_cue',
  'run_demo_cue refuses an unknown cue'
);

select * from finish();
rollback;
