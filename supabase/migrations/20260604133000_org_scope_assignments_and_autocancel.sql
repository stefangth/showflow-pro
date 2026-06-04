-- Phase 3 (Part 12): close the two org-isolation gaps in the booking-engine triggers
-- that the spec (docs/superpowers/specs/2026-06-03-multi-tenancy-design.md §7.3) requires
-- ("read the right org's slot defaults and keep notifications inside the org").
--
-- (a) resolve_show_assignments gains a required p_org and filters show_assignments by it,
--     so a program-only / null-city assignment in one org can NEVER match another org's
--     booking → no cross-org notification recipient.
-- (b) notify_booking_transition() and promote_understudy_on_cancellation() pass NEW.org_id
--     (the booking's org) as the 4th argument to resolve_show_assignments. Bodies are
--     otherwise reproduced VERBATIM from 20260604130000_org_id_derivation_triggers.sql —
--     the notification org_id stamping is unchanged.
-- (c) auto_cancel_on_slot_fill() resolves slot caps via get_org_setting(NEW.org_id, …)
--     instead of reading app_settings directly (mirrors Phase 2's compute_show_date_status),
--     so per-org slot overrides are honoured. The legacy show_id-keyed lookup is DROPPED:
--     slot defaults are keyed by program → sub_program (confirmed against
--     compute_show_date_status in 20260604120000_app_settings_per_org.sql), so the
--     show_id arm could never match a configured cap.

-- ---------------------------------------------------------------------------
-- (a) Org-scope resolve_show_assignments: replace the 3-arg version with a 4-arg
--     version that filters by org_id.
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_show_assignments(text, text, uuid);

create or replace function public.resolve_show_assignments(
  p_program text, p_sub_program text, p_city_id uuid, p_org uuid
) returns table(producer_user_id uuid, specificity int)
language sql stable security definer set search_path = public as $$
  select producer_user_id,
         case
           when sub_program = p_sub_program and city_id = p_city_id then 4
           when city_id = p_city_id and sub_program is null then 3
           when sub_program = p_sub_program and city_id is null then 2
           when city_id is null and sub_program is null then 1
           else 0
         end as specificity
  from show_assignments
  where org_id = p_org
    and program = p_program
    and (sub_program = p_sub_program or sub_program is null)
    and (city_id = p_city_id or city_id is null)
    and case
          when sub_program = p_sub_program and city_id = p_city_id then 4
          when city_id = p_city_id and sub_program is null then 3
          when sub_program = p_sub_program and city_id is null then 2
          when city_id is null and sub_program is null then 1
          else 0
        end > 0
  order by specificity desc;
$$;

grant execute on function public.resolve_show_assignments(text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (b) Update the two trigger callers to pass NEW.org_id (the booking's org) as the
--     4th resolve_show_assignments argument. Bodies reproduced VERBATIM from
--     20260604130000_org_id_derivation_triggers.sql; the ONLY change in each is the
--     added 4th argument. CREATE OR REPLACE keeps the existing trigger bindings.
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
        v_show_date.city_id,
        NEW.org_id
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
        v_show_date.city_id,
        NEW.org_id
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

-- ---------------------------------------------------------------------------
-- (c) Org-scope auto_cancel_on_slot_fill: resolve slot caps from the booking's OWN
--     org via get_org_setting(NEW.org_id, 'sub_program_slots_defaults') instead of
--     reading app_settings directly. Slot defaults are keyed program → sub_program
--     (mirrors compute_show_date_status); the legacy show_id-keyed lookup is dropped.
--     All other logic (confirmed counts, tier_superseded vs slot_filled, the cancel
--     UPDATE) is unchanged. CREATE OR REPLACE keeps slot_fill_auto_cancel_trigger bound.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_cancel_on_slot_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slots          jsonb;
  v_main_cast      INT;
  v_understudies   INT;
  v_confirmed_main INT;
  v_confirmed_u    INT;
  v_min_tier       INT;
BEGIN
  -- Only act on a booking becoming confirmed
  IF TG_OP != 'UPDATE' OR NEW.status != 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NULL;
  END IF;

  -- Resolve slot capacity from the booking's OWN org (override ?? platform default),
  -- keyed program → sub_program (mirrors compute_show_date_status).
  v_slots := public.get_org_setting(NEW.org_id, 'sub_program_slots_defaults');

  SELECT
    COALESCE(NULLIF(v_slots -> s.program -> s.sub_program ->> 'main_cast', '')::int, 0),
    COALESCE(NULLIF(v_slots -> s.program -> s.sub_program ->> 'understudies', '')::int, 0)
  INTO v_main_cast, v_understudies
  FROM show_dates sd
  JOIN shows s ON s.id = sd.show_id
  WHERE sd.id = NEW.show_date_id;

  IF v_main_cast = 0 AND v_understudies = 0 THEN
    RETURN NULL; -- unconfigured pair
  END IF;

  -- Count current confirmed bookings
  SELECT
    COUNT(*) FILTER (WHERE NOT is_understudy),
    COUNT(*) FILTER (WHERE is_understudy)
  INTO v_confirmed_main, v_confirmed_u
  FROM bookings
  WHERE show_date_id = NEW.show_date_id AND status = 'confirmed';

  -- Only proceed if the relevant slot (main or understudy) is now full
  IF (NOT NEW.is_understudy AND v_confirmed_main < v_main_cast) THEN
    RETURN NULL;
  END IF;
  IF (NEW.is_understudy AND v_confirmed_u < v_understudies) THEN
    RETURN NULL;
  END IF;

  -- Find minimum offer_tier among confirmed bookings for this slot type
  SELECT MIN(offer_tier) INTO v_min_tier
  FROM bookings
  WHERE show_date_id = NEW.show_date_id
    AND status = 'confirmed'
    AND is_understudy = NEW.is_understudy
    AND offer_tier IS NOT NULL;

  -- Cancel remaining open bookings for this slot type
  UPDATE bookings
  SET status              = 'cancelled',
      cancelled_at        = now(),
      cancellation_reason = CASE
        WHEN v_min_tier IS NOT NULL AND offer_tier IS NOT NULL AND offer_tier > v_min_tier
          THEN 'tier_superseded'
        ELSE 'slot_filled'
      END
  WHERE show_date_id = NEW.show_date_id
    AND id != NEW.id
    AND is_understudy = NEW.is_understudy
    AND status IN ('suggested', 'soft_booked');

  RETURN NULL;
END;
$$;
