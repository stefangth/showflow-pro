-- Phase 1b-DB (cont.): auto_cancel_on_slot_fill reads slot capacity from the shows
-- columns (main_cast_slots/understudy_slots) instead of the retired app_settings JSON,
-- mirroring compute_show_date_status. NULL columns coalesce to 0 = unconfigured = no auto-cancel.
CREATE OR REPLACE FUNCTION public.auto_cancel_on_slot_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_main_cast      INT;
  v_understudies   INT;
  v_confirmed_main INT;
  v_confirmed_u    INT;
  v_min_tier       INT;
BEGIN
  -- Only act on a booking becoming confirmed
  IF TG_OP != 'UPDATE' OR NEW.status != 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NULL;
  END IF;

  -- Slot capacity now lives on the show row (mirrors compute_show_date_status).
  SELECT COALESCE(s.main_cast_slots, 0), COALESCE(s.understudy_slots, 0)
  INTO v_main_cast, v_understudies
  FROM show_dates sd
  JOIN shows s ON s.id = sd.show_id
  WHERE sd.id = NEW.show_date_id;

  IF v_main_cast = 0 AND v_understudies = 0 THEN
    RETURN NULL; -- unconfigured (NULL/0) → nothing to cap
  END IF;

  -- Count current confirmed bookings
  SELECT
    COUNT(*) FILTER (WHERE NOT is_understudy),
    COUNT(*) FILTER (WHERE is_understudy)
  INTO v_confirmed_main, v_confirmed_u
  FROM bookings
  WHERE show_date_id = NEW.show_date_id AND status = 'confirmed';

  -- Only proceed if the relevant slot (main or understudy) is now full
  IF (NOT NEW.is_understudy AND v_confirmed_main < v_main_cast) THEN
    RETURN NULL;
  END IF;
  IF (NEW.is_understudy AND v_confirmed_u < v_understudies) THEN
    RETURN NULL;
  END IF;

  -- Find minimum offer_tier among confirmed bookings for this slot type
  SELECT MIN(offer_tier) INTO v_min_tier
  FROM bookings
  WHERE show_date_id = NEW.show_date_id
    AND status = 'confirmed'
    AND is_understudy = NEW.is_understudy
    AND offer_tier IS NOT NULL;

  -- Cancel remaining open bookings for this slot type
  UPDATE bookings
  SET status              = 'cancelled',
      cancelled_at        = now(),
      cancellation_reason = CASE
        WHEN v_min_tier IS NOT NULL AND offer_tier IS NOT NULL AND offer_tier > v_min_tier
          THEN 'tier_superseded'
        ELSE 'slot_filled'
      END
  WHERE show_date_id = NEW.show_date_id
    AND id != NEW.id
    AND is_understudy = NEW.is_understudy
    AND status IN ('suggested', 'soft_booked');

  RETURN NULL;
END;
$function$;
