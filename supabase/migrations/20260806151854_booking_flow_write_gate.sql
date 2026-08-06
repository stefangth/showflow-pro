-- booking_flow becomes a real module: an unentitled org cannot write bookings.
--
-- These are RESTRICTIVE policies, so they compose with AND against the existing
-- permissive policies ("Admins manage bookings", "Producers manage bookings",
-- "Artists can respond to own offers") without this migration having to restate
-- their bodies. Restating them is how a stale copy silently reverts behaviour,
-- which is exactly the trap 20260716235007 had to navigate.
--
-- Deliberately INSERT/UPDATE/DELETE only, never FOR ALL: SELECT must stay open so
-- a producer in an unentitled org can still read who is already confirmed.
--
-- Service-role callers (crons, edge functions) and SECURITY DEFINER triggers
-- bypass RLS, so this binds `authenticated` clients only. Those paths are gated
-- at their own layer. In particular cascade_cancel_bookings_on_date_cancel,
-- delete_org and anonymize_user are SECURITY DEFINER and owned by the bookings
-- table owner (postgres) on a table without FORCE ROW LEVEL SECURITY, so they
-- keep working for unentitled orgs.
--
-- bookings.org_id is NOT NULL and is (re)derived by the BEFORE INSERT/UPDATE
-- trg_derive_org_id trigger, which runs before RLS WITH CHECK is evaluated, so
-- the gate always sees the authoritative org.

DROP POLICY IF EXISTS booking_flow_required_insert ON public.bookings;
CREATE POLICY booking_flow_required_insert
ON public.bookings AS RESTRICTIVE FOR INSERT
TO authenticated
WITH CHECK (public.is_feature_enabled(org_id, 'booking_flow'));

DROP POLICY IF EXISTS booking_flow_required_update ON public.bookings;
CREATE POLICY booking_flow_required_update
ON public.bookings AS RESTRICTIVE FOR UPDATE
TO authenticated
USING (public.is_feature_enabled(org_id, 'booking_flow'))
WITH CHECK (public.is_feature_enabled(org_id, 'booking_flow'));

DROP POLICY IF EXISTS booking_flow_required_delete ON public.bookings;
CREATE POLICY booking_flow_required_delete
ON public.bookings AS RESTRICTIVE FOR DELETE
TO authenticated
USING (public.is_feature_enabled(org_id, 'booking_flow'));

-- ===========================================================================
-- promote_understudy_on_cancellation()
--
-- Verbatim copy of the newest body (20260716235007_booking_flow_entitlement_gate.sql,
-- itself the skill-aware body from 20260715130100_skill_aware_understudy_promotion.sql)
-- with the SINGLE addition of the module gate directly after the
-- app.cancelling_show_date guard. Older bodies in 20260714105906 / 20260714182625
-- are superseded and are deliberately NOT recreated here — doing so would revert
-- the skill-aware candidate ORDER BY.
--
-- CREATE OR REPLACE keeps the existing AFTER UPDATE trigger binding.
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

  -- Module gate: an org without booking_flow has no automation at all. Without
  -- this the function reads get_effective_booking_flow, receives NULL, and
  -- COALESCEs straight back into promoting.
  IF NOT public.is_feature_enabled(NEW.org_id, 'booking_flow') THEN
    RETURN NULL;
  END IF;

  -- Booking flow policy gates (org override → platform default → code default true).
  v_flow := public.get_effective_booking_flow(NEW.org_id);
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
  ORDER BY
    (SELECT count(*)
       FROM public.artist_skills cand
      WHERE cand.artist_id = b.artist_id
        AND cand.skill_id IN (
          SELECT lost.skill_id FROM public.artist_skills lost
           WHERE lost.artist_id = NEW.artist_id
        )) DESC,
    b.created_at ASC
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
