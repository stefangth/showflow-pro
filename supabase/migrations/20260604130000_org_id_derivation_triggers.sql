-- Phase 3 (Part 2): derive org_id from the FK parent on every tenant CHILD table,
-- and stamp org_id on the notification inserts inside the booking triggers.
-- The bootstrap org_id column DEFAULT is LEFT IN PLACE (dropped in a later Part) so
-- this migration is purely additive and cannot break any existing insert path.
-- Overwrite-always: once the DEFAULT is dropped, a child inserted with a NULL FK parent
-- yields NULL org_id → NOT NULL violation (the intended fail-loud backstop). Every child
-- FK is NOT NULL except booking_audit_log.booking_id (ON DELETE SET NULL), so that one
-- derive function guards on a non-null FK to avoid nulling an explicitly-set org_id.

create or replace function public.derive_org_id_from_show_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.shows where id = NEW.show_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_show_date_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.show_dates where id = NEW.show_date_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_booking_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- booking_audit_log.booking_id is nullable (ON DELETE SET NULL); only derive when present.
  if NEW.booking_id is not null then
    select org_id into NEW.org_id from public.bookings where id = NEW.booking_id;
  end if;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_cast_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.casts where id = NEW.cast_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_artist_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.artists where id = NEW.artist_id;
  return NEW;
end; $$;

create or replace function public.derive_org_id_from_chat_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select org_id into NEW.org_id from public.chats where id = NEW.chat_id;
  return NEW;
end; $$;

-- parent = shows
drop trigger if exists trg_derive_org_id on public.show_dates;
create trigger trg_derive_org_id before insert on public.show_dates
  for each row execute function public.derive_org_id_from_show_id();
drop trigger if exists trg_derive_org_id on public.show_cast_eligibility;
create trigger trg_derive_org_id before insert on public.show_cast_eligibility
  for each row execute function public.derive_org_id_from_show_id();

-- parent = show_dates
drop trigger if exists trg_derive_org_id on public.bookings;
create trigger trg_derive_org_id before insert on public.bookings
  for each row execute function public.derive_org_id_from_show_date_id();
drop trigger if exists trg_derive_org_id on public.show_date_offer_tiers;
create trigger trg_derive_org_id before insert on public.show_date_offer_tiers
  for each row execute function public.derive_org_id_from_show_date_id();
drop trigger if exists trg_derive_org_id on public.show_date_cast_eligibility;
create trigger trg_derive_org_id before insert on public.show_date_cast_eligibility
  for each row execute function public.derive_org_id_from_show_date_id();
drop trigger if exists trg_derive_org_id on public.chats;
create trigger trg_derive_org_id before insert on public.chats
  for each row execute function public.derive_org_id_from_show_date_id();

-- parent = bookings
drop trigger if exists trg_derive_org_id on public.booking_audit_log;
create trigger trg_derive_org_id before insert on public.booking_audit_log
  for each row execute function public.derive_org_id_from_booking_id();

-- parent = casts
drop trigger if exists trg_derive_org_id on public.cast_members;
create trigger trg_derive_org_id before insert on public.cast_members
  for each row execute function public.derive_org_id_from_cast_id();
drop trigger if exists trg_derive_org_id on public.cast_city_priority;
create trigger trg_derive_org_id before insert on public.cast_city_priority
  for each row execute function public.derive_org_id_from_cast_id();

-- parent = artists
drop trigger if exists trg_derive_org_id on public.artist_skills;
create trigger trg_derive_org_id before insert on public.artist_skills
  for each row execute function public.derive_org_id_from_artist_id();
drop trigger if exists trg_derive_org_id on public.blocked_dates;
create trigger trg_derive_org_id before insert on public.blocked_dates
  for each row execute function public.derive_org_id_from_artist_id();

-- parent = chats
drop trigger if exists trg_derive_org_id on public.chat_messages;
create trigger trg_derive_org_id before insert on public.chat_messages
  for each row execute function public.derive_org_id_from_chat_id();

-- ---------------------------------------------------------------------------
-- Stamp org_id on the notification inserts inside the two booking triggers.
-- Bodies reproduced VERBATIM from 20260603130300_org_scoped_notification_fallback.sql
-- with one change only: every INSERT INTO public.notifications now sets org_id =
-- NEW.org_id as its leading column. booking_audit_log inserts are UNCHANGED
-- (booking_audit_log derives org_id from its own BEFORE INSERT trigger above).
-- CREATE OR REPLACE FUNCTION keeps the existing trigger bindings intact.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.promote_understudy_on_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate        RECORD;
  v_new_status       booking_status;
  v_show_date        RECORD;
  v_producer_user_id UUID;
  v_notified         BOOLEAN := false;
BEGIN
  SELECT id, artist_id, status
  INTO v_candidate
  FROM public.bookings
  WHERE show_date_id = NEW.show_date_id
    AND is_understudy = true
    AND status IN ('soft_booked'::booking_status, 'suggested'::booking_status)
  ORDER BY
    CASE status WHEN 'soft_booked'::booking_status THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_candidate.status = 'soft_booked'::booking_status THEN
    v_new_status := 'confirmed'::booking_status;
  ELSE
    v_new_status := 'soft_booked'::booking_status;
  END IF;

  PERFORM set_config('app.promoting_understudy', 'true', true);

  BEGIN
    UPDATE public.bookings
    SET
      status        = v_new_status,
      is_understudy = false,
      confirmed_at  = CASE WHEN v_new_status = 'confirmed'::booking_status THEN now() ELSE confirmed_at END,
      updated_at    = now()
    WHERE id = v_candidate.id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.promoting_understudy', '', true);
    RAISE;
  END;

  PERFORM set_config('app.promoting_understudy', '', true);

  INSERT INTO public.booking_audit_log (booking_id, action, old_status, new_status, performed_by)
  VALUES (
    v_candidate.id,
    'understudy_promoted',
    v_candidate.status::booking_status,
    v_new_status,
    NULL
  );

  SELECT sd.date, s.program, s.sub_program, sd.city_id
  INTO v_show_date
  FROM public.show_dates sd
  JOIN public.shows s ON s.id = sd.show_id
  WHERE sd.id = NEW.show_date_id;

  INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
  SELECT
    NEW.org_id,
    a.user_id,
    'understudy_promoted',
    'You have been moved to the main cast',
    format(
      'A main cast position has opened for %s on %s and you have been promoted from understudy.',
      COALESCE(
        CASE WHEN v_show_date.sub_program IS NOT NULL
             THEN v_show_date.program || ' — ' || v_show_date.sub_program
             ELSE v_show_date.program
        END,
        'a show'
      ),
      to_char(v_show_date.date, 'DD Mon YYYY')
    ),
    'show_date',
    NEW.show_date_id
  FROM public.artists a
  WHERE a.id = v_candidate.artist_id
    AND a.user_id IS NOT NULL;

  IF v_new_status = 'soft_booked'::booking_status THEN
    FOR v_producer_user_id IN
      SELECT DISTINCT producer_user_id
      FROM public.resolve_show_assignments(
        COALESCE(v_show_date.program, ''),
        v_show_date.sub_program,
        v_show_date.city_id
      )
    LOOP
      v_notified := true;
      INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
      VALUES (
        NEW.org_id,
        v_producer_user_id,
        'booking_ready_to_confirm',
        'Understudy ready to confirm',
        'An understudy has been promoted to main cast and is ready to confirm.',
        'booking',
        v_candidate.id
      );
    END LOOP;

    -- Fallback: notify up to 5 admins of THIS booking's org when no assignment matched
    IF NOT v_notified THEN
      FOR v_producer_user_id IN
        SELECT user_id FROM public.org_memberships
        WHERE org_id = NEW.org_id AND role = 'admin' LIMIT 5
      LOOP
        INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
        VALUES (
          NEW.org_id,
          v_producer_user_id,
          'booking_ready_to_confirm',
          'Understudy ready to confirm',
          'An understudy has been promoted to main cast and is ready to confirm.',
          'booking',
          v_candidate.id
        );
      END LOOP;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_booking_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_show_date        RECORD;
  v_artist_user_id   UUID;
  v_producer_user_id UUID;
  v_notified         BOOLEAN := false;
BEGIN
  IF TG_OP != 'UPDATE' OR OLD.status = NEW.status THEN
    RETURN NULL;
  END IF;

  IF current_setting('app.promoting_understudy', true) = 'true' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.booking_audit_log (booking_id, action, old_status, new_status, performed_by)
  VALUES (NEW.id, 'status_change', OLD.status::booking_status, NEW.status::booking_status, auth.uid());

  SELECT sd.date, sd.city_id, s.program, s.sub_program
  INTO v_show_date
  FROM public.show_dates sd
  JOIN public.shows s ON s.id = sd.show_id
  WHERE sd.id = NEW.show_date_id;

  IF OLD.status = 'soft_booked' AND NEW.status = 'confirmed' THEN
    SELECT a.user_id INTO v_artist_user_id
    FROM public.artists a WHERE a.id = NEW.artist_id;

    IF v_artist_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
      VALUES (
        NEW.org_id,
        v_artist_user_id,
        'booking_confirmed',
        'Booking confirmed',
        format('Your booking for %s on %s has been confirmed.',
               COALESCE(v_show_date.program, 'a show'),
               to_char(v_show_date.date, 'DD Mon YYYY')),
        'booking',
        NEW.id
      );
    END IF;
  END IF;

  IF OLD.status = 'suggested' AND NEW.status = 'soft_booked' THEN
    FOR v_producer_user_id IN
      SELECT DISTINCT producer_user_id
      FROM public.resolve_show_assignments(
        COALESCE(v_show_date.program, ''),
        v_show_date.sub_program,
        v_show_date.city_id
      )
    LOOP
      v_notified := true;
      INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
      VALUES (
        NEW.org_id,
        v_producer_user_id,
        'booking_ready_to_confirm',
        'Artist accepted offer',
        'An artist accepted an offer and is ready to confirm.',
        'booking',
        NEW.id
      );
    END LOOP;

    -- Fallback: notify up to 5 admins of THIS booking's org when no assignment matched
    IF NOT v_notified THEN
      FOR v_producer_user_id IN
        SELECT user_id FROM public.org_memberships
        WHERE org_id = NEW.org_id AND role = 'admin' LIMIT 5
      LOOP
        INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
        VALUES (
          NEW.org_id,
          v_producer_user_id,
          'booking_ready_to_confirm',
          'Artist accepted offer',
          'An artist accepted an offer and is ready to confirm.',
          'booking',
          NEW.id
        );
      END LOOP;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
