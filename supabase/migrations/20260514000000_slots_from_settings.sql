-- Slot capacity is now the responsibility of app_settings.sub_program_slots_defaults,
-- keyed nested as { program: { sub_program: { main_cast, understudies } } }.
-- The per-show and per-date `slots_per_date` columns are removed.

-- 1. Migrate any existing flat settings shape { sub_program: {...} }
--    into the nested shape { program: { sub_program: {...} } } by looking up
--    which program(s) own each sub_program in the shows table.
DO $$
DECLARE
  v_value JSONB;
  v_first_key TEXT;
  v_nested JSONB;
BEGIN
  SELECT value INTO v_value FROM app_settings WHERE key = 'sub_program_slots_defaults';
  IF v_value IS NULL OR v_value = '{}'::JSONB THEN RETURN; END IF;

  -- Heuristic: if any top-level key contains a 'main_cast' field, the value is flat (old shape).
  SELECT jsonb_object_keys(v_value) INTO v_first_key LIMIT 1;
  IF v_first_key IS NOT NULL AND (v_value -> v_first_key ? 'main_cast') THEN
    SELECT jsonb_object_agg(program, sub_map) INTO v_nested
    FROM (
      SELECT s.program, jsonb_object_agg(s.sub_program, v_value -> s.sub_program) AS sub_map
      FROM shows s
      WHERE s.program IS NOT NULL
        AND s.sub_program IS NOT NULL
        AND v_value ? s.sub_program
      GROUP BY s.program
    ) grouped;

    IF v_nested IS NOT NULL THEN
      UPDATE app_settings SET value = v_nested WHERE key = 'sub_program_slots_defaults';
    END IF;
  END IF;
END $$;

-- 2. Drop the old trigger that watched shows.slots_per_date BEFORE dropping the column it depends on.
DROP TRIGGER IF EXISTS sync_show_dates_on_show_update_trigger ON shows;

-- 3. Drop both slots_per_date columns. Order matters: drop child first, then parent.
ALTER TABLE show_dates DROP COLUMN IF EXISTS slots_per_date;
ALTER TABLE shows DROP COLUMN IF EXISTS slots_per_date;

-- 4. Rewrite compute_show_date_status to read main_cast + understudies from settings,
--    keyed by (program, sub_program). Status:
--      'fully_filled' = confirmed_main >= main_cast AND confirmed_us >= understudies
--      'partially_filled' = any non-cancelled booking exists, thresholds not met
--      'open' = no non-cancelled bookings
--      'cancelled' is never overwritten.
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

  IF v_main_cap IS NULL OR v_us_cap IS NULL THEN
    -- Unconfigured (program, sub_program): cannot reach fully_filled
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

-- 5. Trigger that watches shows.program and shows.sub_program (instead of slots_per_date).
CREATE TRIGGER sync_show_dates_on_show_update_trigger
AFTER UPDATE OF program, sub_program ON shows
FOR EACH ROW EXECUTE FUNCTION public.sync_show_dates_on_show_update();

-- 6. New trigger on app_settings — when slot config changes, recompute every show_date.
CREATE OR REPLACE FUNCTION public.sync_show_dates_on_settings_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.key != 'sub_program_slots_defaults' THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT id FROM show_dates LOOP
    PERFORM public.compute_show_date_status(r.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_show_dates_on_settings_update_trigger ON app_settings;
CREATE TRIGGER sync_show_dates_on_settings_update_trigger
AFTER UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION public.sync_show_dates_on_settings_update();
