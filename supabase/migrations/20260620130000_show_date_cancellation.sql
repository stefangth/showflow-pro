-- Airtable-driven date cancellation — DB foundation.
--
-- When an Airtable date's Status = "Cancelled", the airtable-poll edge function
-- (built later) sets show_dates.status = 'cancelled' and imports a reason into the
-- new cancellation_reason column. This migration provides three things:
--
--   (a) the cancellation_reason text column on show_dates;
--   (b) a cascade trigger that releases (cancels) the date's bookings whenever the
--       date itself becomes cancelled, stamping cancellation_reason = 'date_cancelled';
--   (c) an understudy-promotion guard so the cascade does NOT promote an understudy
--       onto a date that is being killed.
--
-- Invariants relied on (verified, not changed here):
--   * compute_show_date_status (20260616172104_slots_on_shows.sql) short-circuits on
--     `v_current = 'cancelled'`, so the booking cancellations the cascade performs —
--     and any later booking write on a cancelled date — never recompute the status
--     back to open/partially_filled. The date stays cancelled.
--   * show_dates SELECT is `USING (true)` for authenticated and bookings'
--     "Artists can view own bookings" is status-agnostic (filters on artist ownership
--     only), so a released artist keeps read access to the cancelled date and to
--     their own cancelled booking. No new SELECT policy is required.

-- ---------------------------------------------------------------------------
-- (a) Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.show_dates
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
COMMENT ON COLUMN public.show_dates.cancellation_reason IS
  'Date-level cancellation reason, synced from Airtable when the mapped Status = Cancelled.';

-- ---------------------------------------------------------------------------
-- (b) Cascade trigger: cancelling a show_date releases its bookings.
--     A transaction-scoped GUC (app.cancelling_show_date) marks the cascade so the
--     understudy-promotion trigger below can opt out (see (c)). The GUC is set just
--     before the UPDATE and cleared right after, so it is only 'true' while the
--     cascade's booking cancellations fire their AFTER triggers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cascade_cancel_bookings_on_date_cancel()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Act only on the transition INTO cancelled. The trigger's WHEN filters to
  -- NEW.status = 'cancelled' using NEW only: a combined INSERT/UPDATE trigger cannot
  -- reference OLD or TG_OP in its WHEN clause (Postgres 42P17), so the "was it already
  -- cancelled?" check lives here. On UPDATE, skip a no-op re-cancel; INSERT always proceeds.
  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelled'::show_date_status THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.cancelling_show_date', 'true', true);
  UPDATE public.bookings
  SET status = 'cancelled'::booking_status, cancelled_at = now(),
      cancellation_reason = 'date_cancelled', updated_at = now()
  WHERE show_date_id = NEW.id AND status <> 'cancelled'::booking_status;
  PERFORM set_config('app.cancelling_show_date', '', true);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS cascade_cancel_bookings_on_date_cancel ON public.show_dates;
CREATE TRIGGER cascade_cancel_bookings_on_date_cancel
AFTER INSERT OR UPDATE OF status ON public.show_dates
FOR EACH ROW
WHEN (NEW.status = 'cancelled'::show_date_status)
EXECUTE FUNCTION public.cascade_cancel_bookings_on_date_cancel();

-- ---------------------------------------------------------------------------
-- (c) Understudy-promotion guard.
--     The cascade cancels confirmed main-cast bookings, which fire
--     promote_understudy_on_cancellation (WHEN OLD.status='confirmed' AND
--     NEW.status='cancelled' AND OLD.is_understudy=false). Without a guard it would
--     promote an understudy onto the dead date — but that understudy is being
--     released by the same cascade. Suppress promotion while app.cancelling_show_date
--     is 'true'.
--
--     Body reproduced VERBATIM from 20260604133000_org_scope_assignments_and_autocancel.sql
--     (the current/latest definition). The ONLY change is the 4-line early-return guard
--     inserted immediately after BEGIN. CREATE OR REPLACE keeps the existing
--     promote_understudy_on_cancellation trigger binding.
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
  -- A whole date is being cancelled (the understudy is being released too) — do not promote.
  IF current_setting('app.cancelling_show_date', true) = 'true' THEN
    RETURN NULL;
  END IF;

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
