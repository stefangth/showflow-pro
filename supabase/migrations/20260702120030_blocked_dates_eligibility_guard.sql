-- M3 — Server-enforce blocked-date booking-conflict + eligibility.
--
-- Problem. blocked_dates RLS (20260514190000) only checks artist ownership.
-- Nothing server-side stops an artist from:
--   (1) blocking a date they already hold an active (non-cancelled) booking on, or
--   (2) blocking a date outside their eligible set.
-- The client calendar (ArtistAvailabilityCalendar) and AvailabilityPicker only
-- render blockable cells for eligible dates, but AvailabilityPage also ships a
-- free-form <input type="date"> that bypasses that gate entirely.
--
-- Fix. A BEFORE INSERT / BEFORE UPDATE OF (date, artist_id) trigger on
-- blocked_dates that RAISEs with a clear message on either violation. Kept as a
-- trigger (not a WITH CHECK) so the error text is actionable. The existing
-- ownership RLS is left untouched — this is an additional integrity gate.
--
-- Eligibility predicate mirrors public useArtistEligibleDates (src/hooks) and
-- open-offer-tier's blocked/eligible read: a date D is eligible for artist A iff
-- there EXISTS an upcoming (date >= CURRENT_DATE), non-cancelled show_date SD on
-- D where one of A's casts (via cast_members) is eligible, either through a
-- per-date override (show_date_cast_eligibility) OR a show+city match
-- (show_cast_eligibility on SD.show_id + SD.city_id, city_id required).

CREATE OR REPLACE FUNCTION public.enforce_blocked_date_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- (1) Booking-conflict: reject when the artist already has an ACTIVE
  --     (non-cancelled) booking on a show_date whose date = the blocked date.
  --     The artist should cancel/decline the booking instead of blocking over it.
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.show_dates sd ON sd.id = b.show_date_id
    WHERE b.artist_id = NEW.artist_id
      AND b.status <> 'cancelled'
      AND sd.date = NEW.date
  ) THEN
    RAISE EXCEPTION
      'Cannot block % — you have an active booking on that date. Decline or cancel the booking first.',
      NEW.date
      USING ERRCODE = 'check_violation';
  END IF;

  -- (2) Eligibility: reject when the date is not in the artist's eligible set.
  --     Faithfully mirrors useArtistEligibleDates (per-date override OR show+city
  --     eligibility, upcoming non-cancelled show_dates only).
  IF NOT EXISTS (
    SELECT 1
    FROM public.show_dates sd
    WHERE sd.date = NEW.date
      AND sd.date >= CURRENT_DATE
      AND sd.status <> 'cancelled'
      AND (
        -- 2a. Per-date override for one of the artist's casts
        EXISTS (
          SELECT 1
          FROM public.show_date_cast_eligibility sdce
          JOIN public.cast_members cm ON cm.cast_id = sdce.cast_id
          WHERE sdce.show_date_id = sd.id
            AND cm.artist_id = NEW.artist_id
        )
        -- 2b. Show + city eligibility for one of the artist's casts
        OR (
          sd.city_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.show_cast_eligibility sce
            JOIN public.cast_members cm ON cm.cast_id = sce.cast_id
            WHERE sce.show_id = sd.show_id
              AND sce.city_id = sd.city_id
              AND cm.artist_id = NEW.artist_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot block % — it is not one of your eligible dates.',
      NEW.date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Fire on INSERT and on any UPDATE that changes the (artist_id, date) pair —
-- the two columns the checks depend on. A reason-only UPDATE is untouched.
DROP TRIGGER IF EXISTS trg_enforce_blocked_date_eligibility ON public.blocked_dates;
CREATE TRIGGER trg_enforce_blocked_date_eligibility
  BEFORE INSERT OR UPDATE OF date, artist_id ON public.blocked_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_blocked_date_eligibility();

COMMENT ON FUNCTION public.enforce_blocked_date_eligibility() IS
  'M3: rejects a blocked_dates row when the artist has an active booking on that date, or when the date is outside their eligible set (mirrors useArtistEligibleDates / open-offer-tier).';
