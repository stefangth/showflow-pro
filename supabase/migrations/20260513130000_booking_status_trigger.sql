-- Computes and updates show_dates.status based on confirmed booking counts
-- vs the effective slot capacity (show_dates.slots_per_date overrides shows.slots_per_date).
-- Never overwrites a 'cancelled' status — that is set explicitly by mutations.

CREATE OR REPLACE FUNCTION public.compute_show_date_status(p_show_date_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status  show_date_status;
  v_slots_per_date  INT;
  v_confirmed       INT;
  v_any_active      INT;
  v_new_status      show_date_status;
BEGIN
  SELECT
    sd.status,
    COALESCE(sd.slots_per_date, s.slots_per_date)
  INTO v_current_status, v_slots_per_date
  FROM show_dates sd
  JOIN shows s ON s.id = sd.show_id
  WHERE sd.id = p_show_date_id;

  -- Row not found or already cancelled — leave it alone
  IF NOT FOUND OR v_current_status = 'cancelled' THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_confirmed
  FROM bookings
  WHERE show_date_id = p_show_date_id AND status = 'confirmed';

  IF v_confirmed >= v_slots_per_date THEN
    v_new_status := 'fully_filled';
  ELSE
    SELECT COUNT(*) INTO v_any_active
    FROM bookings
    WHERE show_date_id = p_show_date_id AND status != 'cancelled';

    IF v_any_active > 0 THEN
      v_new_status := 'partially_filled';
    ELSE
      v_new_status := 'open';
    END IF;
  END IF;

  UPDATE show_dates SET status = v_new_status WHERE id = p_show_date_id;
END;
$$;


-- Trigger function: fires after any booking INSERT / UPDATE / DELETE
CREATE OR REPLACE FUNCTION public.sync_show_date_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.compute_show_date_status(OLD.show_date_id);
  ELSE
    PERFORM public.compute_show_date_status(NEW.show_date_id);
    -- On a booking move between dates, also recompute the old date
    IF TG_OP = 'UPDATE' AND OLD.show_date_id IS DISTINCT FROM NEW.show_date_id THEN
      PERFORM public.compute_show_date_status(OLD.show_date_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_show_date_status_trigger ON bookings;
CREATE TRIGGER sync_show_date_status_trigger
AFTER INSERT OR UPDATE OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_show_date_status();


-- Secondary trigger: if a show's slot capacity changes, recompute all its dates
CREATE OR REPLACE FUNCTION public.sync_show_dates_on_show_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM show_dates WHERE show_id = NEW.id LOOP
    PERFORM public.compute_show_date_status(r.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_show_dates_on_show_update_trigger ON shows;
CREATE TRIGGER sync_show_dates_on_show_update_trigger
AFTER UPDATE OF slots_per_date ON shows
FOR EACH ROW EXECUTE FUNCTION public.sync_show_dates_on_show_update();
