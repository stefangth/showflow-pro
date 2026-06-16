-- Bookings derive org_id from their show_date AND must reference an artist in the
-- same org. The shared derive_org_id_from_show_date_id() is unchanged and still
-- serves the other show_date children (offer tiers, date eligibility, chats);
-- bookings get a dedicated derive-and-guard function.
CREATE OR REPLACE FUNCTION public.derive_org_id_for_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_artist_org uuid;
BEGIN
  SELECT org_id INTO NEW.org_id FROM public.show_dates WHERE id = NEW.show_date_id;
  SELECT org_id INTO v_artist_org FROM public.artists WHERE id = NEW.artist_id;
  IF v_artist_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'artist % (org %) does not belong to the booking''s org % (from show_date %)',
      NEW.artist_id, v_artist_org, NEW.org_id, NEW.show_date_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.bookings;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT OR UPDATE OF artist_id, show_date_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_booking();
