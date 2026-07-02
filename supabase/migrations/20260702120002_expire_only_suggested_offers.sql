-- C3 — Stop expiring accepted (soft_booked) offers.
--
-- expire_soft_bookings() (20260514210000_expire_soft_bookings_fn.sql) cancelled
-- status IN ('suggested','soft_booked') past offer_expires_at. But accepting an offer
-- only flips status to 'soft_booked' (OfferResponseButtons) and never clears
-- offer_expires_at, so an artist who accepted on time was silently cancelled when the
-- producer didn't confirm before the deadline — contradicting the UI promise
-- ("Anyone who already accepted keeps their spot", src/lib/bookings.ts) and firing no
-- notification.
--
-- Maintainer decision (already made): accepted (soft_booked) holds NEVER auto-expire;
-- only an untouched 'suggested' offer past its deadline expires. The hourly
-- expire-offers cron and its escalation path do not independently cancel soft_booked
-- rows, so narrowing the WHERE here is sufficient.
--
-- CREATE OR REPLACE keeps the existing GRANT/binding. The ONLY change vs the prior
-- definition is the status filter: IN ('suggested','soft_booked') → = 'suggested'.

CREATE OR REPLACE FUNCTION public.expire_soft_bookings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only expire untouched offers. Accepted holds (soft_booked) persist until a
  -- producer confirms or cancels them.
  UPDATE bookings
  SET status              = 'cancelled',
      cancelled_at        = now(),
      cancellation_reason = 'offer_expired'
  WHERE status = 'suggested'
    AND offer_expires_at IS NOT NULL
    AND offer_expires_at < now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_soft_bookings() TO authenticated;
