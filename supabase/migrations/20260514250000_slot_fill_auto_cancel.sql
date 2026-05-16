-- Auto-cancel remaining suggested/soft_booked bookings for a show_date when
-- confirmed bookings reach or exceed capacity (main_cast + understudies).
--
-- cancellation_reason:
--   'tier_superseded' — cancelled booking had a higher offer_tier number than
--                        the minimum tier among confirmed bookings (lower priority lost)
--   'slot_filled'     — otherwise (same tier, or no tier info)

CREATE OR REPLACE FUNCTION public.auto_cancel_on_slot_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Resolve slot capacity from app_settings.sub_program_slots_defaults
  SELECT
    COALESCE(
      NULLIF(app.value -> sd.show_id::text ->> 'main_cast', '')::int,
      NULLIF(app.value -> s.program -> s.sub_program ->> 'main_cast', '')::int,
      0
    ),
    COALESCE(
      NULLIF(app.value -> sd.show_id::text ->> 'understudies', '')::int,
      NULLIF(app.value -> s.program -> s.sub_program ->> 'understudies', '')::int,
      0
    )
  INTO v_main_cast, v_understudies
  FROM show_dates sd
  JOIN shows s ON s.id = sd.show_id
  CROSS JOIN (
    SELECT value FROM app_settings WHERE key = 'sub_program_slots_defaults'
  ) app
  WHERE sd.id = NEW.show_date_id;

  -- If we couldn't resolve capacity, skip
  IF v_main_cast IS NULL OR v_main_cast = 0 THEN
    -- Fall back to jsonb path (program → sub_program → main_cast)
    SELECT
      COALESCE(NULLIF(a.value -> s.program -> s.sub_program ->> 'main_cast', '')::int, 0),
      COALESCE(NULLIF(a.value -> s.program -> s.sub_program ->> 'understudies', '')::int, 0)
    INTO v_main_cast, v_understudies
    FROM show_dates sd
    JOIN shows s ON s.id = sd.show_id
    CROSS JOIN (SELECT value FROM app_settings WHERE key = 'sub_program_slots_defaults') a
    WHERE sd.id = NEW.show_date_id;
  END IF;

  IF v_main_cast = 0 AND v_understudies = 0 THEN
    RETURN NULL; -- unconfigured pair
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
$$;

DROP TRIGGER IF EXISTS slot_fill_auto_cancel_trigger ON public.bookings;
CREATE TRIGGER slot_fill_auto_cancel_trigger
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.auto_cancel_on_slot_fill();
