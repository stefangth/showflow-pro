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
--     tests can hard-code the ids.
--   * Nothing that fires an outbound trigger. Show dates stay `open`, which is
--     why there are no bookings here: a date reaching `fully_filled` fires
--     dispatch_hire_order_drafts, which calls an edge function.
--   * NO super-admin. Preview branch projects are internet-reachable and have
--     their own public anon key, so a platform_admins row whose password is
--     committed in this file would be a published god-mode account on every open
--     PR. Grant yourself one locally instead, against your own database only:
--       insert into public.platform_admins (user_id)
--       values ('22222222-2222-2222-2222-222222222222');
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
      ('22222222-2222-2222-2222-222222222222'::uuid, 'admin@example.com',    'Dev Admin'),
      ('33333333-3333-3333-3333-333333333333'::uuid, 'producer@example.com', 'Dev Producer'),
      ('44444444-4444-4444-4444-444444444444'::uuid, 'artist@example.com',   'Dev Artist')
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
  ('00000000-0000-0000-0000-00000000b007', '22222222-2222-2222-2222-222222222222', 'admin'),
  ('00000000-0000-0000-0000-00000000b007', '33333333-3333-3333-3333-333333333333', 'producer'),
  ('00000000-0000-0000-0000-00000000b007', '44444444-4444-4444-4444-444444444444', 'artist')
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
values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-00000000b007', 'Example City')
on conflict (id) do nothing;

insert into public.casts (id, org_id, name, description)
values (
  '66666666-6666-6666-6666-666666666666',
  '00000000-0000-0000-0000-00000000b007',
  'Ensemble A',
  'Seeded cast for local development.'
)
on conflict (id) do nothing;

-- user_id links the artist row to the artist login, which is what the artist
-- surfaces (availability, offers, bookings) resolve through.
insert into public.artists (id, org_id, user_id, name, email, status, cast_role)
values (
  '77777777-7777-7777-7777-777777777777',
  '00000000-0000-0000-0000-00000000b007',
  '44444444-4444-4444-4444-444444444444',
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
  '66666666-6666-6666-6666-666666666666',
  '77777777-7777-7777-7777-777777777777',
  '00000000-0000-0000-0000-00000000b007'
)
on conflict do nothing;

insert into public.shows (id, org_id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, sort_order)
values
  ('88888888-8888-8888-8888-000000000001', '00000000-0000-0000-0000-00000000b007',
   'Evening Programme', 'Set A', 'Main stage', 'Seeded show for local development.', 'active', 2, 1, 1),
  ('88888888-8888-8888-8888-000000000002', '00000000-0000-0000-0000-00000000b007',
   'Matinee Programme', 'Set B', 'Main stage', 'Seeded show for local development.', 'active', 1, 1, 2)
on conflict (id) do nothing;

-- Dates are relative to the run date on purpose: a fixture pinned to fixed
-- calendar dates silently drifts into the past and stops appearing in the UI.
-- Status stays `open` so no fill-status or hire-order dispatch trigger fires.
insert into public.show_dates (id, org_id, show_id, date, city_id, venue, status, session_1, duration_minutes)
values
  ('99999999-9999-9999-9999-000000000001', '00000000-0000-0000-0000-00000000b007',
   '88888888-8888-8888-8888-000000000001', current_date + 14,
   '55555555-5555-5555-5555-555555555555', 'Example Venue', 'open', '19:30', 90),
  ('99999999-9999-9999-9999-000000000002', '00000000-0000-0000-0000-00000000b007',
   '88888888-8888-8888-8888-000000000001', current_date + 21,
   '55555555-5555-5555-5555-555555555555', 'Example Venue', 'open', '19:30', 90),
  ('99999999-9999-9999-9999-000000000003', '00000000-0000-0000-0000-00000000b007',
   '88888888-8888-8888-8888-000000000002', current_date + 28,
   '55555555-5555-5555-5555-555555555555', 'Example Venue', 'open', '15:00', 75)
on conflict (id) do nothing;
