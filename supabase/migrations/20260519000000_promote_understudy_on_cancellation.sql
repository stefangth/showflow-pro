-- Trigger: when a confirmed main-cast booking is cancelled, automatically
-- promote the best available understudy to fill the vacant slot.
--
-- Promotion rules:
--   • Only fires when OLD.status = 'confirmed' AND NEW.status = 'cancelled'
--     AND OLD.is_understudy = false (a confirmed main-cast slot was released).
--   • Picks the best candidate: is_understudy = true, status IN
--     ('soft_booked', 'suggested'), same show_date. Prefers soft_booked over
--     suggested; ties broken by earliest created_at.
--   • soft_booked understudy → confirmed main cast (confirmed_at = now())
--   • suggested understudy  → soft_booked main cast
--   • Appends to booking_audit_log; notifies the promoted artist.
--   • When a suggested understudy reaches soft_booked, also notifies producers
--     via resolve_show_assignments (+ admin fallback) because
--     notify_booking_transition is suppressed for system-driven promotions.
--
-- SECURITY DEFINER required: booking_audit_log and notifications both
-- restrict INSERT to admins/producers via RLS.

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
  -- Find the best understudy: prefer soft_booked, then suggested; oldest first.
  -- The WHEN clause on the trigger guarantees OLD.status = 'confirmed',
  -- NEW.status = 'cancelled', OLD.is_understudy = false before we get here.
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

  -- Suppress notify_booking_transition for this system-driven status change.
  -- Without this guard, that trigger fires and sends wrong "artist accepted offer"
  -- notifications and calls resolve_show_assignments unnecessarily.
  PERFORM set_config('app.promoting_understudy', 'true', true);

  -- Promote: move to main cast with the new status
  UPDATE public.bookings
  SET
    status        = v_new_status,
    is_understudy = false,
    confirmed_at  = CASE WHEN v_new_status = 'confirmed'::booking_status THEN now() ELSE confirmed_at END,
    updated_at    = now()
  WHERE id = v_candidate.id;

  PERFORM set_config('app.promoting_understudy', '', true);

  -- Audit log: written for every promotion (skipped by notify_booking_transition
  -- on this same UPDATE because of the GUC guard set above)
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

DROP TRIGGER IF EXISTS promote_understudy_on_cancellation ON public.bookings;
CREATE TRIGGER promote_understudy_on_cancellation
AFTER UPDATE ON public.bookings
FOR EACH ROW
WHEN (OLD.status = 'confirmed' AND NEW.status = 'cancelled' AND OLD.is_understudy = false)
EXECUTE FUNCTION public.promote_understudy_on_cancellation();

-- Partial index to accelerate the understudy candidate lookup
CREATE INDEX IF NOT EXISTS idx_bookings_understudy_candidate
  ON public.bookings (show_date_id, created_at)
  WHERE is_understudy = true AND status IN ('soft_booked', 'suggested');
