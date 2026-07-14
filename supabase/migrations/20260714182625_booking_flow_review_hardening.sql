-- PR #161 external code review: database-layer hardening (booking flow).
--
-- Four independent findings from the review of PR #161's booking-flow work, plus
-- one pre-existing org_id tamper item, are fixed here. Each redefined object is a
-- verbatim copy of its current definition with the minimal edit described in its
-- section header; nothing else in any body changes. Section index:
--   1. Fix 1 (High):   suggested -> confirmed fires no booking_confirmed notification
--   2. Fix 2 + Fix 3:  promote_understudy_on_cancellation() unvalidated boolean casts
--                      + confirmed_at overwrite on already-confirmed promotions
--   3. Fix 2 (policy): "Artists can respond to own offers" unvalidated boolean cast
--   4. Fix 4:          bookings org_id tamper surface (trg_derive_org_id columns)

-- ===========================================================================
-- Section 1 -- Fix 1 (High): notify_booking_transition() sends no notification on
-- suggested -> confirmed.
--
-- The auto-confirm flow (booking_flow.producer_confirmation = false) lets an artist
-- accept an offer straight to confirmed, i.e. suggested -> confirmed. The current
-- confirmed branch only matched OLD.status = 'soft_booked', so those one-step
-- confirmations produced no booking_confirmed notification for the artist. Copied
-- verbatim from 20260604133000_org_scope_assignments_and_autocancel.sql with a
-- single edit: the confirmed branch predicate widened from
--   OLD.status = 'soft_booked'
-- to
--   OLD.status IN ('soft_booked', 'suggested')
-- so a one-step confirm gets the SAME booking_confirmed notification as the
-- two-step path. Everything else is byte-identical; CREATE OR REPLACE keeps the
-- existing trigger binding.
-- ===========================================================================
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

-- ===========================================================================
-- Section 2 -- Fix 2 + Fix 3: promote_understudy_on_cancellation().
--
-- Fix 2 (Medium): the two booking_flow reads cast the raw jsonb text to boolean
-- ((v_flow->>'understudy_promotion')::boolean and ...->>'artist_acceptance'). A
-- malformed stored value such as "maybe" makes the cast throw, and because this is
-- a BEFORE-cancel trigger the exception aborts the cancellation for the whole org.
-- The casts are replaced with throw-free text comparisons that keep the exact prior
-- defaults: understudy_promotion is treated as disabled only when the value is
-- exactly 'false' (case-insensitive), promotion enabled otherwise; artist_acceptance
-- is true unless the value is exactly 'false'.
--
-- Fix 3 (Low): the promotion UPDATE stamped confirmed_at = now() unconditionally
-- (v_new_status is always 'confirmed'), clobbering the original timestamp when the
-- candidate was already confirmed (direct mode). The CASE now preserves the existing
-- confirmed_at when v_candidate.status is already 'confirmed' and stamps now()
-- otherwise.
--
-- Copied verbatim from 20260714105906_understudy_promotion_flow_gates.sql with
-- exactly those three line edits; CREATE OR REPLACE keeps the trigger binding.
-- ===========================================================================
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
  IF COALESCE(lower(v_flow->>'understudy_promotion'), 'true') = 'false' THEN
    RETURN NEW;
  END IF;
  v_acceptance := COALESCE(lower(v_flow->>'artist_acceptance'), 'true') <> 'false';

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
      confirmed_at  = CASE WHEN v_candidate.status = 'confirmed'::booking_status THEN confirmed_at ELSE now() END,
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

-- ===========================================================================
-- Section 3 -- Fix 2 (Medium, policy): "Artists can respond to own offers".
--
-- The confirmed branch of the WITH CHECK cast the org's producer_confirmation
-- setting to boolean ((...->>'producer_confirmation')::boolean), so a malformed
-- stored value threw and errored the artist's accept instead of just denying it.
-- Copied verbatim from 20260714111652_artist_self_confirm_policy.sql with the cast
-- replaced by the same throw-free text comparison: self-confirm is allowed only when
-- producer_confirmation is exactly 'false' (case-insensitive), denied otherwise
-- (the prior default: producer confirmation on -> no self-confirm).
-- ===========================================================================
DROP POLICY IF EXISTS "Artists can respond to own offers" ON public.bookings;
CREATE POLICY "Artists can respond to own offers"
ON public.bookings FOR UPDATE
TO authenticated
USING (
  artist_id IN (
    SELECT id FROM public.artists WHERE user_id = auth.uid()
  )
  AND status = 'suggested'
)
WITH CHECK (
  artist_id IN (
    SELECT id FROM public.artists WHERE user_id = auth.uid()
  )
  AND (
    status IN ('soft_booked', 'cancelled')
    OR (
      status = 'confirmed'
      AND COALESCE(
        lower(public.get_org_setting(
          (SELECT sd.org_id FROM public.show_dates sd WHERE sd.id = show_date_id),
          'booking_flow')->>'producer_confirmation'),
        'true'
      ) = 'false'
    )
  )
);

-- ===========================================================================
-- Section 4 -- Fix 4 (pre-existing hardening): bookings org_id tamper surface.
--
-- trg_derive_org_id (20260616162454_bookings_artist_org_guard.sql) fired only
-- BEFORE INSERT OR UPDATE OF artist_id, show_date_id, so an UPDATE that touched only
-- org_id (with an unchanged artist_id/show_date_id) skipped re-derivation. A
-- multi-org artist could thus mislabel a booking's org_id. Re-point the trigger to
-- also fire on UPDATE OF org_id; derive_org_id_for_booking() already re-derives
-- org_id from the show_date and re-checks the artist's org, so any tampered value is
-- simply overwritten. The function is unchanged; only the trigger's column list
-- gains org_id.
-- ===========================================================================
DROP TRIGGER IF EXISTS trg_derive_org_id ON public.bookings;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT OR UPDATE OF artist_id, show_date_id, org_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_booking();
