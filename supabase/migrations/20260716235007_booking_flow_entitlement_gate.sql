-- Entitlement gate for trigger-time booking-flow reads.
--
-- Task 3 of the entitlements platform work. Adds get_effective_booking_flow(_org),
-- an entitlement-aware wrapper over get_org_setting(_org,'booking_flow'): it returns
-- the org's stored booking_flow config only when the org is entitled to the
-- booking_flow feature (is_feature_enabled, default-on from
-- 20260716233515_org_entitlements.sql), and NULL otherwise. A NULL makes every
-- existing caller COALESCE back to its classic hard-coded default, so an unentitled
-- org silently behaves like the pre-booking-flow product (classic defaults).
--
-- The two live objects that read booking_flow at trigger/policy time are then
-- re-pointed at the wrapper. Each is a VERBATIM copy of its current NEWEST definition
-- with the SINGLE edit of swapping the read expression
--   public.get_org_setting(<org>, 'booking_flow')  ->  public.get_effective_booking_flow(<org>)
-- and nothing else:
--   1. promote_understudy_on_cancellation() — newest body in
--      20260715130100_skill_aware_understudy_promotion.sql (the skill-aware candidate
--      ORDER BY is preserved exactly; the older 20260714105906 / 20260714182625
--      bodies are superseded and are deliberately NOT recreated here — doing so would
--      revert the skill-aware ordering).
--   2. RLS policy "Artists can respond to own offers" — newest definition in
--      20260714182625_booking_flow_review_hardening.sql (Section 3).
-- The four grep hits for get_org_setting(...,'booking_flow') across the migration tree
-- collapse to these two distinct live objects; the remaining two hits are stale
-- promote_understudy bodies that a later migration already replaced.

create or replace function public.get_effective_booking_flow(_org uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_feature_enabled(_org, 'booking_flow')
      then public.get_org_setting(_org, 'booking_flow')
    else null
  end;
$$;

-- ===========================================================================
-- 1. promote_understudy_on_cancellation()
-- Verbatim copy of the newest body (20260715130100_skill_aware_understudy_promotion.sql)
-- with the single edit at the booking-flow read: get_org_setting → get_effective_booking_flow.
-- CREATE OR REPLACE keeps the existing trigger binding.
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

-- ===========================================================================
-- 2. RLS policy "Artists can respond to own offers"
-- Verbatim copy of the newest definition (20260714182625_booking_flow_review_hardening.sql,
-- Section 3) with the single edit at the booking-flow read:
-- get_org_setting(<org>, 'booking_flow') → get_effective_booking_flow(<org>).
-- When the org is unentitled the wrapper returns NULL, so producer_confirmation
-- resolves to its classic default ('true') and self-confirm is denied — the exact
-- pre-booking-flow behaviour.
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
        lower(public.get_effective_booking_flow(
          (SELECT sd.org_id FROM public.show_dates sd WHERE sd.id = show_date_id)
        )->>'producer_confirmation'),
        'true'
      ) = 'false'
    )
  )
);
