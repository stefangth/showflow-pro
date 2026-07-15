-- Booking flow Phase 3 gap 1: direct-booking orgs INSERT bookings as
-- status='confirmed' with no offer step (createBooking with confirmDirectly),
-- so no UPDATE transition ever fires for them and notify_booking_transition()
-- — being AFTER UPDATE only — never notified the linked artist. This migration
-- adds an AFTER INSERT branch: a booking INSERTed with status='confirmed'
-- notifies the linked artist (type='booking_confirmed'), same title/message as
-- the existing UPDATE-path confirmation. Offer INSERTs (status='suggested')
-- and unlinked artists stay silent. Email is unchanged: the confirmation
-- digest already covers direct bookings.
--
-- Content is a VERBATIM copy of the current notify_booking_transition()
-- definition (supabase/migrations/20260714182625_booking_flow_review_hardening.sql
-- Section 1, lines 30-125), with exactly one addition: the INSERT branch below,
-- placed immediately after BEGIN and before the
-- `IF TG_OP != 'UPDATE' OR OLD.status = NEW.status THEN RETURN NULL; END IF;`
-- guard. The audit-log INSERT stays UPDATE-only (there is no OLD row to audit a
-- status_change against on INSERT). The trigger is recreated to also fire
-- AFTER INSERT; NEW.org_id is already derived by the BEFORE trigger
-- trg_derive_org_id, so it is safe to use here.
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
  -- Phase 3: direct-booking orgs INSERT bookings as 'confirmed' with no offer
  -- step (createBooking with confirmDirectly), so no UPDATE transition ever
  -- fires for them and the artist was never notified in-app. Handle INSERTs
  -- here; offers land as 'suggested' and are skipped. Email is unchanged: the
  -- confirmation digest already covers direct bookings.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      SELECT sd.date, sd.city_id, s.program, s.sub_program
      INTO v_show_date
      FROM public.show_dates sd
      JOIN public.shows s ON s.id = sd.show_id
      WHERE sd.id = NEW.show_date_id;

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
    RETURN NULL;
  END IF;

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

  IF OLD.status IN ('soft_booked', 'suggested') AND NEW.status = 'confirmed' THEN
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

DROP TRIGGER IF EXISTS notify_booking_transition_trigger ON public.bookings;
CREATE TRIGGER notify_booking_transition_trigger
AFTER INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_booking_transition();
