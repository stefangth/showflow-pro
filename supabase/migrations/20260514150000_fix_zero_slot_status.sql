-- When both main_cast and understudies thresholds are configured as 0,
-- the previous trigger set fully_filled immediately (0 >= 0 AND 0 >= 0).
-- Treat a 0/0 config as unconfigured: status follows active-booking count
-- (partially_filled / open) and can never reach fully_filled.

CREATE OR REPLACE FUNCTION public.compute_show_date_status(p_show_date_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current      show_date_status;
  v_program      TEXT;
  v_sub_program  TEXT;
  v_settings     JSONB;
  v_main_cap     INT;
  v_us_cap       INT;
  v_conf_main    INT;
  v_conf_us      INT;
  v_active       INT;
  v_new          show_date_status;
BEGIN
  SELECT sd.status, s.program, s.sub_program
  INTO v_current, v_program, v_sub_program
  FROM show_dates sd
  JOIN shows s ON s.id = sd.show_id
  WHERE sd.id = p_show_date_id;

  IF NOT FOUND OR v_current = 'cancelled' THEN
    RETURN;
  END IF;

  SELECT value INTO v_settings
  FROM app_settings
  WHERE key = 'sub_program_slots_defaults';

  IF v_program IS NOT NULL AND v_sub_program IS NOT NULL AND v_settings IS NOT NULL THEN
    v_main_cap := NULLIF(v_settings -> v_program -> v_sub_program ->> 'main_cast', '')::INT;
    v_us_cap   := NULLIF(v_settings -> v_program -> v_sub_program ->> 'understudies', '')::INT;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'confirmed' AND NOT is_understudy),
    COUNT(*) FILTER (WHERE status = 'confirmed' AND is_understudy),
    COUNT(*) FILTER (WHERE status != 'cancelled')
  INTO v_conf_main, v_conf_us, v_active
  FROM bookings
  WHERE show_date_id = p_show_date_id;

  -- Treat NULL capacity or a 0/0 config as unconfigured: fully_filled is unreachable.
  IF v_main_cap IS NULL OR v_us_cap IS NULL OR (v_main_cap = 0 AND v_us_cap = 0) THEN
    v_new := CASE WHEN v_active > 0 THEN 'partially_filled' ELSE 'open' END;
  ELSIF v_conf_main >= v_main_cap AND v_conf_us >= v_us_cap THEN
    v_new := 'fully_filled';
  ELSIF v_active > 0 THEN
    v_new := 'partially_filled';
  ELSE
    v_new := 'open';
  END IF;

  UPDATE show_dates SET status = v_new WHERE id = p_show_date_id;
END;
$$;

-- Recompute all non-cancelled show_dates with the corrected function.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM show_dates WHERE status != 'cancelled' LOOP
    PERFORM public.compute_show_date_status(r.id);
  END LOOP;
END $$;
