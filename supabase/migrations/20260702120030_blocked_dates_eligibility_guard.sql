-- M3 — Server-enforce blocked-date booking-conflict ONLY.
--
-- Problem. blocked_dates RLS (20260514190000) only checks artist ownership.
-- Nothing server-side stops an artist from blocking a date they already hold an
-- active (non-cancelled) booking on — they should decline/cancel the booking
-- instead of blocking over a commitment.
--
-- Fix. A BEFORE INSERT / BEFORE UPDATE OF (date, artist_id) trigger on
-- blocked_dates that RAISEs with a clear message on that conflict. Kept as a
-- trigger (not a WITH CHECK) so the error text is actionable. The existing
-- ownership RLS is left untouched — this is an additional integrity gate.
--
-- Scope note. An earlier draft of this guard ALSO rejected blocks on dates
-- outside the artist's eligible set. That eligibility check was intentionally
-- dropped: a block on a non-eligible date is inert (no offers flow to a date the
-- artist can't be cast on), and server-enforcing it broke legitimate proactive
-- blocking. Eligibility remains a client-side UX guide only — the blocked-date
-- picker (AvailabilityPage / ArtistAvailabilityCalendar) offers eligible dates —
-- while the sole server-enforced rule here is the booking conflict.

CREATE OR REPLACE FUNCTION public.enforce_blocked_date_no_active_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Booking-conflict: reject when the artist already has an ACTIVE
  -- (non-cancelled) booking on a show_date whose date = the blocked date.
  -- The artist should cancel/decline the booking instead of blocking over it.
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

  RETURN NEW;
END;
$$;

-- Fire on INSERT and on any UPDATE that changes the (artist_id, date) pair —
-- the two columns the check depends on. A reason-only UPDATE is untouched.
DROP TRIGGER IF EXISTS trg_enforce_blocked_date_no_active_booking ON public.blocked_dates;
CREATE TRIGGER trg_enforce_blocked_date_no_active_booking
  BEFORE INSERT OR UPDATE OF date, artist_id ON public.blocked_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_blocked_date_no_active_booking();

COMMENT ON FUNCTION public.enforce_blocked_date_no_active_booking() IS
  'M3: rejects a blocked_dates row when the artist has an active (non-cancelled) booking on that date. Eligibility is enforced client-side only.';
