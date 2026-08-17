-- Demo mode: wipe_demo_org + seed_demo_org RPCs.
--
-- wipe_demo_org is the single most dangerous operation in the app: it deletes
-- every tenant row for an org. The guard at the top reads is_demo from the
-- SAME row it is about to wipe and refuses (raises) when it is not exactly
-- true. Callers (edge function / UI) are expected to re-check too, but this
-- function must never trust the caller and must never soften the guard to a
-- WHERE clause.

create or replace function public.wipe_demo_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select is_demo from public.organizations where id = p_org) is not true then
    raise exception 'wipe_demo_org refused: % is not a demo org', p_org
      using errcode = 'raise_exception';
  end if;

  -- FK-safe order. Only tenant DATA is removed; the org row, memberships,
  -- entitlements and app_settings (booking flow) are preserved.
  delete from public.demo_captured_sends where org_id = p_org;
  delete from public.hire_order_signatures where org_id = p_org;
  delete from public.hire_order_dates where org_id = p_org;
  delete from public.hire_orders where org_id = p_org;
  delete from public.chat_messages where org_id = p_org;
  delete from public.chats where org_id = p_org;
  delete from public.show_date_offer_tiers where org_id = p_org;
  delete from public.blocked_dates where org_id = p_org;
  delete from public.notifications where org_id = p_org;
  delete from public.bookings where org_id = p_org;
  delete from public.show_dates where org_id = p_org;
  delete from public.cast_members where org_id = p_org;
  delete from public.artists where org_id = p_org;
  delete from public.casts where org_id = p_org;
  delete from public.cities where org_id = p_org;
  delete from public.shows where org_id = p_org;
end;
$$;

-- Only the service role (via the demo-ops edge function) may execute this; revoke
-- from anon/authenticated too so it can never be called directly through PostgREST,
-- bypassing the edge role gate, and grant service_role explicitly (not via Supabase's
-- implicit default-privileges) in the same migration, per the hardening precedent in
-- 20260703100321_harden_rpc_grants_service_role_only.sql.
revoke all on function public.wipe_demo_org(uuid) from public, anon, authenticated;
grant execute on function public.wipe_demo_org(uuid) to service_role;

-- seed_demo_org populates a demo org with a realistic, self-consistent
-- dataset: cities, one cast, artists, shows, show_dates, bookings covering
-- every state, one open offer tier, hire orders covering draft/issued/
-- countersigned, an optional chat + notifications when an actor is known,
-- and one blocked date. Ids are gen_random_uuid() -- wipe is by org_id, so
-- no fixed ids are needed. Every show_date stays below fully_filled
-- (main_cast_slots = 3, never more than 1 confirmed non-understudy booking
-- per date) so the dispatch_hire_order_drafts net.http_post never fires
-- during a seed; hire-order rows are inserted directly instead.
create or replace function public.seed_demo_org(
  p_org uuid,
  p_volume text default 'full',
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_show_count int := case when p_volume = 'small' then 3 else 6 end;
  v_artist_count int := case when p_volume = 'small' then 8 else 16 end;
  v_city_ids uuid[] := array[]::uuid[];
  v_cast_id uuid;
  v_artist_ids uuid[] := array[]::uuid[];
  v_show_ids uuid[] := array[]::uuid[];
  v_date_ids uuid[] := array[]::uuid[];
  v_id uuid;
  i int;
  j int;
begin
  if (select is_demo from public.organizations where id = p_org) is not true then
    raise exception 'seed_demo_org refused: % is not a demo org', p_org
      using errcode = 'raise_exception';
  end if;

  -- Cities (4 for a multi-venue feel).
  for i in 1..4 loop
    insert into public.cities (org_id, name)
    values (p_org, (array['Rheinbühne Köln','Stadttheater Bonn','Kammerspiele Düsseldorf','Werkstatt Aachen'])[i])
    returning id into v_id;
    v_city_ids := v_city_ids || v_id;
  end loop;

  -- One cast bucket.
  insert into public.casts (org_id, name, description)
  values (p_org, 'Ensemble', 'Demo ensemble.') returning id into v_cast_id;

  -- Artists (no login; user_id null). One row per artist.
  for i in 1..v_artist_count loop
    insert into public.artists (org_id, name, email, status, cast_role)
    values (
      p_org,
      (array['Yasmin Aydın','Elisa Brandt','Marco Reinsdorf','Jonas Vogt','Lena Hofer','Amir Kaya',
             'Sophie Neumann','Tobias Frank','Nora Baumann','Paul Richter','Mila Sanchez','Ben Kraus',
             'Hana Lindqvist','Omar Said','Frida Moll','Leon Weiss'])[i],
      'artist-' || i || '@demo.invalid',   -- non-routable: emails can never escape
      'active',
      (array['Performer','Vocalist','Dancer','Musician'])[1 + (i % 4)]
    ) returning id into v_id;
    v_artist_ids := v_artist_ids || v_id;
    insert into public.cast_members (org_id, cast_id, artist_id) values (p_org, v_cast_id, v_id);
  end loop;

  -- Shows. main_cast_slots MUST be > 0 so dates can (later, via a cue) fill.
  -- NOTE: PL/pgSQL's `... RETURNING x INTO target` requires a simple
  -- variable target -- it cannot subscript an array directly ("cannot
  -- subscript type uuid because it does not support subscripting"). Capture
  -- into the scalar v_id first, then assign the array element as a plain
  -- statement (which plpgsql does allow to subscript).
  for i in 1..v_show_count loop
    insert into public.shows (org_id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, sort_order)
    values (
      p_org,
      (array['Hamlet','Die Zauberflöte','Faust','Der Sturm','La Bohème','Kabarett Nacht'])[i],
      'Spielzeit 26/27', 'Hauptbühne', 'Demo show.', 'active', 3, 1, i
    ) returning id into v_id;
    v_show_ids[i] := v_id;
  end loop;

  -- Show dates: for each show, ~4 dates spanning today+2 .. today+90.
  for i in 1..v_show_count loop
    for j in 0..3 loop
      insert into public.show_dates (org_id, show_id, date, city_id, venue, status, session_1, duration_minutes)
      values (
        p_org, v_show_ids[i],
        current_date + 2 + (i * 5) + (j * 18),
        v_city_ids[1 + ((i + j) % 4)],
        (array['Grand Theatre','Riverside Hall','Lakeside Arena','Werkstatt']) [1 + ((i + j) % 4)],
        'open', (array['19:30','15:00','20:00']::time[])[1 + (j % 3)], 90
      ) returning id into v_id;
      v_date_ids := v_date_ids || v_id;
    end loop;
  end loop;

  -- Bookings covering every state. Never 3 confirmed non-understudy on one date
  -- (main_cast_slots = 3) so no date reaches fully_filled. Distinct dates per state.
  -- suggested
  insert into public.bookings (org_id, show_date_id, artist_id, status, offer_tier)
  values (p_org, v_date_ids[1], v_artist_ids[1], 'suggested', 1);
  -- soft_booked "holds" expiring today 17:00 (the scene-03 story)
  insert into public.bookings (org_id, show_date_id, artist_id, status, offer_tier, offer_expires_at)
  values (p_org, v_date_ids[2], v_artist_ids[2], 'soft_booked', 1, (current_date + interval '17 hours'));
  insert into public.bookings (org_id, show_date_id, artist_id, status, offer_tier, offer_expires_at)
  values (p_org, v_date_ids[3], v_artist_ids[3], 'soft_booked', 1, (current_date + interval '17 hours'));
  -- confirmed (1 of 3 → date stays partially_filled)
  insert into public.bookings (org_id, show_date_id, artist_id, status, confirmed_at)
  values (p_org, v_date_ids[4], v_artist_ids[4], 'confirmed', now());
  -- understudy confirmed
  insert into public.bookings (org_id, show_date_id, artist_id, status, is_understudy, confirmed_at)
  values (p_org, v_date_ids[5], v_artist_ids[5], 'confirmed', true, now());
  -- cancelled
  insert into public.bookings (org_id, show_date_id, artist_id, status, cancelled_at, cancellation_reason)
  values (p_org, v_date_ids[6], v_artist_ids[6], 'cancelled', now(), 'Artist unavailable');

  -- An open offer tier (the "at risk" surface reads from tiers + bookings).
  insert into public.show_date_offer_tiers (org_id, show_date_id, tier)
  values (p_org, v_date_ids[2], 1);

  -- Hire orders: one of each of draft / issued / countersigned. Left UNLINKED
  -- (artist_id/show_date_id null) to skip the active-artist-date dedup and the
  -- org-derive cross-check; `data` carries the display payload.
  insert into public.hire_orders (org_id, order_no, status, data, fee_amount, fee_currency)
  values
    (p_org, 'HO-DEMO-0001', 'draft',
     jsonb_build_object('artist_name','Yasmin Aydın','show','Hamlet','date', to_char(current_date + 20,'DD.MM.YYYY')), 450.00, 'EUR'),
    (p_org, 'HO-DEMO-0002', 'issued',
     jsonb_build_object('artist_name','Elisa Brandt','show','Die Zauberflöte','date', to_char(current_date + 27,'DD.MM.YYYY')), 520.00, 'EUR'),
    (p_org, 'HO-DEMO-0003', 'countersigned',
     jsonb_build_object('artist_name','Marco Reinsdorf','show','Faust','date', to_char(current_date + 34,'DD.MM.YYYY')), 480.00, 'EUR');

  -- A chat thread with one message (from the actor, when known).
  if p_actor is not null then
    insert into public.chats (org_id, show_date_id, created_by)
    values (p_org, v_date_ids[4], p_actor) returning id into v_id;
    insert into public.chat_messages (org_id, chat_id, user_id, body)
    values (p_org, v_id, p_actor, 'Willkommen. Alles bereit für die Vorstellung.');

    -- A few unread notifications so the bell is alive.
    insert into public.notifications (user_id, org_id, type, title, message, read)
    values
      (p_actor, p_org, 'offer_accepted', 'Angebot angenommen', 'Yasmin Aydın hat zugesagt.', false),
      (p_actor, p_org, 'tier_at_risk', 'Frist läuft ab', 'Zwei Angebote laufen heute um 17:00 ab.', false);
  end if;

  -- One artist with declared blocked dates.
  insert into public.blocked_dates (org_id, artist_id, date, reason)
  values (p_org, v_artist_ids[1], current_date + 40, 'Urlaub');

  -- Record the chosen volume.
  insert into public.demo_state (org_id, volume) values (p_org, p_volume)
  on conflict (org_id) do update set volume = excluded.volume, updated_at = now();
end;
$$;

-- Service-role-only (see wipe_demo_org above): block direct anon/authenticated calls
-- and grant service_role explicitly in the same migration.
revoke all on function public.seed_demo_org(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.seed_demo_org(uuid, text, uuid) to service_role;
