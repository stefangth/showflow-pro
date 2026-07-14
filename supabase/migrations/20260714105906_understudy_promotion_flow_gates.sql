-- Booking flow (Milestone B): gate understudy promotion on the org's booking_flow policy.
--
-- The M4 definition (20260702120003_understudy_promotion_require_acceptance.sql) always
-- promoted the longest-waiting ACCEPTED (soft_booked) understudy when a confirmed main
-- was cancelled. Milestone B makes the booking flow configurable per org
-- (app_settings key "booking_flow", resolved via get_org_setting → org override ??
-- platform default ?? code default true), and promotion must honor two of its toggles:
--
--   * understudy_promotion = false → promotion is disabled entirely; the cancellation
--     leaves the understudy untouched.
--   * artist_acceptance = false ("direct mode") → understudies never had an accept step,
--     so there is no soft_booked hold to promote from. In that mode a CONFIRMED understudy
--     is the eligible candidate (alongside soft_booked, for orgs mid-transition).
--
-- This is a CREATE OR REPLACE of the M4 body reproduced verbatim from
-- 20260702120003_understudy_promotion_require_acceptance.sql:32-132 with exactly three
-- edits: (1) two DECLARE vars (v_flow, v_acceptance); (2) a booking-flow policy gate
-- inserted right after the app.cancelling_show_date guard; (3) the candidate status
-- filter widened to include confirmed understudies when artist_acceptance is off.
--
-- Everything else — the FOR UPDATE SKIP LOCKED lock, the promotion UPDATE to confirmed +
-- is_understudy=false, the audit-log row, and the understudy_promoted notification — is
-- byte-identical. v_new_status stays hardcoded to 'confirmed', so a promoted candidate
-- ends confirmed with is_understudy=false in BOTH modes. In direct mode a confirmed
-- candidate takes a same-status confirmed→confirmed UPDATE, which passes
-- enforce_booking_transition() via its NEW.status = OLD.status short-circuit. The M4
-- "Only ACCEPTED (soft_booked) understudies…" candidate comment is left unchanged (the
-- copied body stays pristine); the direct-mode widening is documented here instead.
--
-- CREATE OR REPLACE keeps the existing promote_understudy_on_cancellation trigger binding.

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
  v_flow             jsonb;
  v_acceptance       boolean;
BEGIN
  -- A whole date is being cancelled (the understudy is being released too) — do not promote.
  IF current_setting('app.cancelling_show_date', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Booking flow policy gates (org override → platform default → code default true).
  v_flow := public.get_org_setting(NEW.org_id, 'booking_flow');
  IF COALESCE((v_flow->>'understudy_promotion')::boolean, true) = false THEN
    RETURN NEW;
  END IF;
  v_acceptance := COALESCE((v_flow->>'artist_acceptance')::boolean, true);

  -- Only ACCEPTED (soft_booked) understudies are eligible, and only if they have NOT
  -- blocked the show_date's date. A suggested (unaccepted) understudy is never promoted.
  SELECT b.id, b.artist_id, b.status
  INTO v_candidate
  FROM public.bookings b
  JOIN public.show_dates sd ON sd.id = b.show_date_id
  WHERE b.show_date_id = NEW.show_date_id
    AND b.is_understudy = true
    AND (
      (v_acceptance AND b.status = 'soft_booked'::booking_status)
      OR (NOT v_acceptance AND b.status IN ('soft_booked'::booking_status, 'confirmed'::booking_status))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_dates bd
      WHERE bd.artist_id = b.artist_id
        AND bd.date = sd.date
    )
  ORDER BY b.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Every candidate is an accepted (soft_booked) understudy, so promotion confirms them.
  v_new_status := 'confirmed'::booking_status;

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

  RETURN NULL;
END;
$$;
