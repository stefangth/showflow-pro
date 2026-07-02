-- M4 — Understudy promotion: require prior acceptance and respect blocked_dates.
--
-- The prior definition (latest: 20260620130000_show_date_cancellation.sql) selected the
-- promotion candidate with status IN ('soft_booked','suggested') and, in the 'suggested'
-- branch, promoted an understudy who had NEVER accepted — marking a hold without consent.
-- It also never joined blocked_dates, so an understudy who blocked the date after being
-- offered could still be promoted onto it.
--
-- Maintainer decision (recommended in the spec): promote ONLY accepted understudies
-- (status soft_booked); leave suggested (unaccepted) ones as plain offers. Add a
-- blocked_dates guard so an understudy who blocked the show_date's date is skipped.
--
-- Body reproduced from 20260620130000_show_date_cancellation.sql. Changes vs that version:
--   1. candidate WHERE: status IN ('soft_booked','suggested')  →  status = 'soft_booked'
--      (require prior acceptance);
--   2. candidate WHERE gains a NOT EXISTS (blocked_dates for that artist on the date)
--      guard, so a blocked accepted understudy is skipped;
--   3. because every candidate is now soft_booked, promotion always resolves to
--      'confirmed'. The suggested→soft_booked branch and its producer "ready to confirm"
--      notification block are removed as dead code (a suggested understudy is no longer
--      promoted, so no ready-to-confirm signal is produced by this path).
--
-- Preserved unchanged: the app.cancelling_show_date early-return guard, FOR UPDATE
-- SKIP LOCKED, the app.promoting_understudy GUC handling, the audit-log row, and the
-- understudy_promoted notification to the promoted artist. CREATE OR REPLACE keeps the
-- existing promote_understudy_on_cancellation trigger binding.
--
-- NOTE: the candidate SELECT joins the show_date's date (show_dates.date) to filter
-- blocked_dates(artist_id, date); NEW here is the just-cancelled main-cast booking, so
-- NEW.show_date_id identifies the date.

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
  -- A whole date is being cancelled (the understudy is being released too) — do not promote.
  IF current_setting('app.cancelling_show_date', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Only ACCEPTED (soft_booked) understudies are eligible, and only if they have NOT
  -- blocked the show_date's date. A suggested (unaccepted) understudy is never promoted.
  SELECT b.id, b.artist_id, b.status
  INTO v_candidate
  FROM public.bookings b
  JOIN public.show_dates sd ON sd.id = b.show_date_id
  WHERE b.show_date_id = NEW.show_date_id
    AND b.is_understudy = true
    AND b.status = 'soft_booked'::booking_status
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
