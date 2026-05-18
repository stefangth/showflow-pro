-- When a suggested understudy is promoted to soft_booked by
-- promote_understudy_on_cancellation, notify_booking_transition is suppressed
-- via the GUC guard to avoid a spurious "artist accepted offer" notification.
-- But that also suppresses the correct booking_ready_to_confirm notification
-- that producers need to know they have a booking to confirm.
-- This patch adds that producer notification directly inside the trigger.

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
    CASE status::text WHEN 'soft_booked' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_candidate.status::text = 'soft_booked' THEN
    v_new_status := 'confirmed'::booking_status;
  ELSE
    v_new_status := 'soft_booked'::booking_status;
  END IF;

  PERFORM set_config('app.promoting_understudy', 'true', true);

  UPDATE public.bookings
  SET
    status        = v_new_status,
    is_understudy = false,
    confirmed_at  = CASE WHEN v_new_status = 'confirmed'::booking_status THEN now() ELSE confirmed_at END,
    updated_at    = now()
  WHERE id = v_candidate.id;

  PERFORM set_config('app.promoting_understudy', '', true);

  INSERT INTO public.booking_audit_log (booking_id, action, old_status, new_status, performed_by)
  VALUES (
    v_candidate.id,
    'understudy_promoted',
    v_candidate.status::booking_status,
    v_new_status,
    NULL
  );

  -- Fetch show context (program, sub_program, city_id) for notifications
  SELECT sd.date, s.program, s.sub_program, sd.city_id
  INTO v_show_date
  FROM public.show_dates sd
  JOIN public.shows s ON s.id = sd.show_id
  WHERE sd.id = NEW.show_date_id;

  -- Notify the promoted artist
  INSERT INTO public.notifications (user_id, type, title, message, related_entity_type, related_entity_id)
  SELECT
    a.user_id,
    'understudy_promoted',
    'You have been moved to the main cast',
    format(
      'A main cast position has opened for %s on %s and you have been promoted from understudy.',
      COALESCE(v_show_date.program, 'a show'),
      to_char(v_show_date.date, 'DD Mon YYYY')
    ),
    'show_date',
    NEW.show_date_id
  FROM public.artists a
  WHERE a.id = v_candidate.artist_id
    AND a.user_id IS NOT NULL;

  -- When a suggested understudy reaches soft_booked, producers need to confirm it.
  -- notify_booking_transition is suppressed via the GUC guard for this path,
  -- so issue booking_ready_to_confirm directly using the same routing logic.
  IF v_new_status = 'soft_booked'::booking_status THEN
    FOR v_producer_user_id IN
      SELECT DISTINCT producer_user_id
      FROM public.resolve_show_assignments(
        COALESCE(v_show_date.program, ''),
        v_show_date.sub_program,
        v_show_date.city_id
      )
      LIMIT 5
    LOOP
      v_notified := true;
      INSERT INTO public.notifications (user_id, type, title, message, related_entity_type, related_entity_id)
      VALUES (
        v_producer_user_id,
        'booking_ready_to_confirm',
        'Understudy ready to confirm',
        'An understudy has been promoted to main cast and is ready to confirm.',
        'booking',
        v_candidate.id
      );
    END LOOP;

    -- Fallback: notify all admins when no assignment matched
    IF NOT v_notified THEN
      FOR v_producer_user_id IN
        SELECT user_id FROM public.user_roles WHERE role = 'admin'
      LOOP
        INSERT INTO public.notifications (user_id, type, title, message, related_entity_type, related_entity_id)
        VALUES (
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
