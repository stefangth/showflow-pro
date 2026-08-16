-- Development seed data.
--
-- Applied automatically by `supabase db reset` locally, and by Supabase when a
-- preview branch is created (branches come up with NO production data, and
-- onboarding is invite-only with no signup form, so without this a freshly
-- migrated database cannot be logged into at all).
--
-- Rules for anything added here:
--   * SYNTHETIC ONLY. No production rows, no real names, no real addresses.
--     @example.com is reserved by RFC 2606 and cannot receive mail, so a stray
--     email send in a dev environment goes nowhere.
--   * Fixed UUIDs and `on conflict do nothing`, so re-running is a no-op and
--     tests can hard-code the ids. Every seed-owned id lives in the `5eed…`
--     namespace: `supabase start` seeds the same database the pgTAP job then
--     runs against, and supabase/tests/** already owns the repeated-digit space
--     (11111111-…, 22222222-… and friends), so anything else collides on a
--     duplicate key. scripts/seedUuidIsolation.test.mjs enforces this.
--   * Nothing that fires an outbound trigger. Show dates stay `open`, which is
--     why there are no bookings here: a date reaching `fully_filled` fires
--     dispatch_hire_order_drafts, which calls an edge function.
--   * NO super-admin. Preview branch projects are internet-reachable and have
--     their own public anon key, so a platform_admins row whose password is
--     committed in this file would be a published god-mode account on every open
--     PR. Grant yourself one locally instead, against your own database only:
--       insert into public.platform_admins (user_id)
--       values ('5eed0000-0000-0000-0000-000000000001');
--   * The ORG ADMIN below is a committed credential on an internet-reachable
--     preview project, and that is a deliberate, bounded trade rather than an
--     oversight. An org admin can invite arbitrary addresses, read member
--     contact details and change org settings, so the reasoning has to hold:
--       - the repository is private, so the password and the branch project ref
--         are visible only to people who already have repo access;
--       - a preview branch holds only the synthetic rows in this file, and is
--         deleted when its PR closes;
--       - preview branches carry no function secrets today, so an invite cannot
--         become real outbound mail.
--     The third point is the one that can change. If branch-level secrets are
--     ever configured — a live RESEND_API_KEY above all — this stops being
--     acceptable: drop the admin row and grant it by hand like the super-admin.
--   * Dates below are relative to the run date, so the fixture is NOT
--     reproducible across days. Tests must derive expectations from
--     `current_date` rather than hard-code a date or a grid position.
--
-- Sign in as any of the three users below with the password: showflow-dev
--
--   admin@example.com     org admin
--   producer@example.com  org producer
--   artist@example.com    org artist, linked to the seeded artist row
--
-- The bootstrap org (00000000-0000-0000-0000-00000000b007) is created by
-- migration 20260603120100_add_org_id_to_tenant_tables.sql, so it already
-- exists on any migrated database and is not re-created here.

-- Fail with a readable message rather than a bare foreign-key violation if that
-- ever stops being true.
do $$
begin
  if not exists (select 1 from public.organizations where id = '00000000-0000-0000-0000-00000000b007') then
    raise exception
      'Seed expects the bootstrap org 00000000-0000-0000-0000-00000000b007 (created by migration 20260603120100). It is absent, so supabase/seed.sql needs updating to the current onboarding model.';
  end if;
end $$;

-- ── Auth users ───────────────────────────────────────────────────────────────
-- Created directly rather than through the Auth admin API, because a seed file
-- is plain SQL. `handle_new_user` fires on insert and creates the profile from
-- raw_user_meta_data.display_name. pgcrypto lives in the `extensions` schema, so
-- crypt/gen_salt must be schema-qualified.
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('5eed0000-0000-0000-0000-000000000001'::uuid, 'admin@example.com',    'Dev Admin'),
      ('5eed0000-0000-0000-0000-000000000002'::uuid, 'producer@example.com', 'Dev Producer'),
      ('5eed0000-0000-0000-0000-000000000003'::uuid, 'artist@example.com',   'Dev Artist')
    ) as t(id, email, display_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('showflow-dev', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', u.display_name),
      '', '', '', ''
    )
    on conflict (id) do nothing;

    -- GoTrue resolves a password login through auth.identities, not auth.users
    -- alone, so a user without this row exists but cannot sign in.
    insert into auth.identities (
      user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    )
    values (
      u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email),
      now(), now(), now()
    )
    on conflict do nothing;
  end loop;
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
-- Access is org membership: without a row here a user lands on NoOrgScreen.
-- See the header for why no platform_admins row is seeded.
insert into public.org_memberships (org_id, user_id, role)
values
  ('00000000-0000-0000-0000-00000000b007', '5eed0000-0000-0000-0000-000000000001', 'admin'),
  ('00000000-0000-0000-0000-00000000b007', '5eed0000-0000-0000-0000-000000000002', 'producer'),
  ('00000000-0000-0000-0000-00000000b007', '5eed0000-0000-0000-0000-000000000003', 'artist')
on conflict (org_id, user_id, role) do nothing;

-- ── Entitlements ─────────────────────────────────────────────────────────────
-- hire_orders ships dark (FEATURE_REGISTRY defaultEnabled: false), so without an
-- explicit row the module is invisible in every dev and preview database — for
-- the surface under the most active development. Turn it on here; the production
-- default is unaffected, because this file never runs against production.
insert into public.org_entitlements (org_id, feature, enabled)
values ('00000000-0000-0000-0000-00000000b007', 'hire_orders', true)
on conflict do nothing;

-- ── Catalog ──────────────────────────────────────────────────────────────────
-- Tenant tables carry a NOT NULL org_id with no default, so it is always explicit.
insert into public.cities (id, org_id, name)
values ('5eed0000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000b007', 'Example City')
on conflict (id) do nothing;

insert into public.casts (id, org_id, name, description)
values (
  '5eed0000-0000-0000-0000-0000000000ca',
  '00000000-0000-0000-0000-00000000b007',
  'Ensemble A',
  'Seeded cast for local development.'
)
on conflict (id) do nothing;

-- user_id links the artist row to the artist login, which is what the artist
-- surfaces (availability, offers, bookings) resolve through.
insert into public.artists (id, org_id, user_id, name, email, status, cast_role)
values (
  '5eed0000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-00000000b007',
  '5eed0000-0000-0000-0000-000000000003',
  'Dev Artist',
  'artist@example.com',
  'active',
  'Performer'
)
-- Untargeted on purpose: artists also carries a partial unique index on
-- (org_id, user_id), which an `on conflict (id)` target would not intercept.
on conflict do nothing;

insert into public.cast_members (cast_id, artist_id, org_id)
values (
  '5eed0000-0000-0000-0000-0000000000ca',
  '5eed0000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-00000000b007'
)
on conflict do nothing;

insert into public.shows (id, org_id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, sort_order)
values
  ('5eed0000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b007',
   'Evening Programme', 'Set A', 'Main stage', 'Seeded show for local development.', 'active', 2, 1, 1),
  ('5eed0000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b007',
   'Matinee Programme', 'Set B', 'Main stage', 'Seeded show for local development.', 'active', 1, 1, 2)
on conflict (id) do nothing;

-- Dates are relative to the run date on purpose: a fixture pinned to fixed
-- calendar dates silently drifts into the past and stops appearing in the UI.
-- Status stays `open` so no fill-status or hire-order dispatch trigger fires.
-- `d1` deliberately carries a second session (a matinee + an evening show the
-- same day) so the calendar's inline session "+N" indicator is demonstrable on
-- a fresh local stack: Month/Agenda show "15:00 +1" for this production-date.
insert into public.show_dates (id, org_id, show_id, date, city_id, venue, status, session_1, session_2, session_3, duration_minutes)
values
  ('5eed0000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000b007',
   '5eed0000-0000-0000-0000-0000000000e1', current_date + 14,
   '5eed0000-0000-0000-0000-0000000000c1', 'Example Venue', 'open', '15:00', '19:30', null, 90),
  ('5eed0000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000b007',
   '5eed0000-0000-0000-0000-0000000000e1', current_date + 21,
   '5eed0000-0000-0000-0000-0000000000c1', 'Example Venue', 'open', '19:30', null, null, 90),
  ('5eed0000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-00000000b007',
   '5eed0000-0000-0000-0000-0000000000e2', current_date + 28,
   '5eed0000-0000-0000-0000-0000000000c1', 'Example Venue', 'open', '15:00', null, null, 75)
on conflict (id) do nothing;

-- ── Scale-up: a fuller world, heavy on FUTURE show dates ─────────────────────
-- Same rules as everything above — synthetic only, ids in the `5eed…` namespace,
-- `on conflict do nothing`, and show_dates kept `open` so no fill-status or
-- hire-order dispatch trigger fires. The bulk rows (extra artists and the future
-- dates) are generated with generate_series so the calendar is densely populated
-- without a hand-written row each; their ids are built from the row number,
-- still inside `5eed…`. Everything is additive to the rows above.

-- More cities (multi-venue feel).
insert into public.cities (id, org_id, name) values
  ('5eed0000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000b007', 'Rivertown'),
  ('5eed0000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000b007', 'Lakeside'),
  ('5eed0000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-00000000b007', 'Hillford'),
  ('5eed0000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-00000000b007', 'Port Meadow')
on conflict (id) do nothing;

-- More casts.
insert into public.casts (id, org_id, name, description) values
  ('5eed0000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000b007', 'Ensemble B', 'Seeded cast for local development.'),
  ('5eed0000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000b007', 'Ensemble C', 'Seeded cast for local development.')
on conflict (id) do nothing;

-- More shows (varied programmes and slot shapes).
insert into public.shows (id, org_id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, sort_order) values
  ('5eed0000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000b007', 'Late Night Revue',   'Set C', 'Club',       'Seeded show for local development.', 'active', 3, 1, 3),
  ('5eed0000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000b007', 'Family Spectacular', 'Set D', 'Main stage', 'Seeded show for local development.', 'active', 4, 2, 4),
  ('5eed0000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000b007', 'Chamber Session',    'Set E', 'Studio',     'Seeded show for local development.', 'active', 2, 0, 5),
  ('5eed0000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000b007', 'Touring Gala',       'Set F', 'Arena',      'Seeded show for local development.', 'active', 5, 2, 6)
on conflict (id) do nothing;

-- 15 more catalog artists (no login; user_id null). Deterministic 5eed ids
-- 5eed0000-…-0000000a0001 … 000f. cast_role rotates for variety.
insert into public.artists (id, org_id, user_id, name, email, status, cast_role)
select
  ('5eed0000-0000-0000-0000-0000000a' || lpad(to_hex(n), 4, '0'))::uuid,
  '00000000-0000-0000-0000-00000000b007',
  null,
  'Ensemble Artist ' || lpad(n::text, 2, '0'),
  'artist-' || lpad(n::text, 2, '0') || '@example.com',
  'active',
  (array['Performer','Vocalist','Dancer','Musician','Understudy'])[1 + (n % 5)]
from generate_series(1, 15) as n
on conflict do nothing;

-- Spread those artists across the three casts.
insert into public.cast_members (cast_id, artist_id, org_id)
select
  (array[
    '5eed0000-0000-0000-0000-0000000000ca',
    '5eed0000-0000-0000-0000-0000000000cb',
    '5eed0000-0000-0000-0000-0000000000cc'
  ]::uuid[])[1 + (n % 3)],
  ('5eed0000-0000-0000-0000-0000000a' || lpad(to_hex(n), 4, '0'))::uuid,
  '00000000-0000-0000-0000-00000000b007'
from generate_series(1, 15) as n
on conflict do nothing;

-- FUTURE show dates: for each of the six shows, 12 dates on a per-show cadence,
-- from a few days out to ~5 months ahead, rotating through the five cities. Kept
-- `open`. Ids are 5eed0000-…-0000000dNNNN by row number (distinct from d1..d3).
with cfg (show_id, interval_days, session_1, duration_minutes, city_seed) as (
  values
    ('5eed0000-0000-0000-0000-0000000000e1'::uuid,  7, '19:30', 90,  0),
    ('5eed0000-0000-0000-0000-0000000000e2'::uuid, 10, '15:00', 75,  1),
    ('5eed0000-0000-0000-0000-0000000000e3'::uuid,  6, '21:00', 60,  2),
    ('5eed0000-0000-0000-0000-0000000000e4'::uuid, 14, '14:00', 120, 3),
    ('5eed0000-0000-0000-0000-0000000000e5'::uuid,  9, '18:00', 80,  4),
    ('5eed0000-0000-0000-0000-0000000000e6'::uuid, 12, '20:00', 100, 0)
),
gen as (
  select
    cfg.show_id,
    cfg.session_1,
    cfg.duration_minutes,
    1 + ((cfg.city_seed + wk.k) % 5) as idx,
    (current_date + 3 + cfg.interval_days * wk.k)::date as d,
    row_number() over (order by cfg.show_id, wk.k) as rn
  from cfg
  cross join generate_series(0, 11) as wk(k)
)
insert into public.show_dates (id, org_id, show_id, date, city_id, venue, status, session_1, duration_minutes)
select
  ('5eed0000-0000-0000-0000-0000000d' || lpad(to_hex(gen.rn::int), 4, '0'))::uuid,
  '00000000-0000-0000-0000-00000000b007',
  gen.show_id,
  gen.d,
  (array[
    '5eed0000-0000-0000-0000-0000000000c1',
    '5eed0000-0000-0000-0000-0000000000c2',
    '5eed0000-0000-0000-0000-0000000000c3',
    '5eed0000-0000-0000-0000-0000000000c4',
    '5eed0000-0000-0000-0000-0000000000c5'
  ]::uuid[])[gen.idx],
  (array['Grand Theatre','Riverside Hall','Lakeside Arena','Hillford Playhouse','Port Meadow Stage']::text[])[gen.idx],
  'open',
  gen.session_1::time,
  gen.duration_minutes
from gen
on conflict (id) do nothing;

-- Point in-DB edge-function dispatch at the LOCAL stack instead of production, so local/CI/preview
-- pg_cron jobs and triggers never fire at prod (prod rejects their mismatched cron secret with 401
-- and that noise pollutes prod's System Health metrics). seed.sql never runs on production, so the
-- migration's production default (private.functions_base_url) is untouched there. Any non-prod value
-- satisfies the goal (do not hit prod); http://kong:8000 is the local stack's internal gateway.
-- A plain INSERT (not ALTER DATABASE ... SET): the seed runs as the non-owner `postgres` role,
-- which lacks privilege to set a database/role parameter but owns private.runtime_config.
insert into private.runtime_config (key, value)
values ('functions_base_url', 'http://kong:8000')
on conflict (key) do update set value = excluded.value;
