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
  v_candidate  RECORD;
  v_new_status booking_status;
  v_show_date  RECORD;
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

  -- Promote: move to main cast with the new status
  UPDATE public.bookings
  SET
    status        = v_new_status,
    is_understudy = false,
    confirmed_at  = CASE WHEN v_new_status = 'confirmed'::booking_status THEN now() ELSE confirmed_at END,
    updated_at    = now()
  WHERE id = v_candidate.id;

  -- Audit log
  INSERT INTO public.booking_audit_log (booking_id, action, old_status, new_status, performed_by)
  VALUES (
    v_candidate.id,
    'understudy_promoted',
    v_candidate.status::booking_status,
    v_new_status,
    NULL
  );

  -- Resolve show context for the notification message
  SELECT sd.date, s.program
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

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS promote_understudy_on_cancellation ON public.bookings;
CREATE TRIGGER promote_understudy_on_cancellation
AFTER UPDATE ON public.bookings
FOR EACH ROW
WHEN (OLD.status = 'confirmed' AND NEW.status = 'cancelled' AND OLD.is_understudy = false)
EXECUTE FUNCTION public.promote_understudy_on_cancellation();
