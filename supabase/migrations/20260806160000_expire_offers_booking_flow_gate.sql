-- expire_soft_bookings() must respect the booking_flow module gate.
--
-- The hourly expire-offers cron calls this RPC with the service-role client before
-- any org or entitlement filtering, and the function itself is SECURITY DEFINER and
-- fleet-wide, so it bypasses the RESTRICTIVE booking_flow_required_* policies added
-- in 20260806150000_booking_flow_write_gate.sql by design.
--
-- Without an org predicate that made disabling the module DRAIN an org instead of
-- FREEZING it: every 'suggested' offer past its deadline was cancelled within the
-- hour, and 'cancelled' is terminal, so re-enabling the module could not restore
-- them. That contradicts the module's governing decision (docs/adr/README.md:
-- "pending offers are left exactly as they are (no bulk-cancel)").
--
-- Verbatim copy of the newest body (20260702120002_expire_only_suggested_offers.sql,
-- confirmed against the live pg_get_functiondef) with the SINGLE addition of the
-- is_feature_enabled predicate. CREATE OR REPLACE keeps the existing GRANT/binding.

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
    AND offer_expires_at < now()
    -- Module gate: an unentitled org's pending offers are frozen, not drained.
    AND public.is_feature_enabled(org_id, 'booking_flow');
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_soft_bookings() TO authenticated;
