-- Idempotent reconciliation of expire_soft_bookings().
-- Referenced in types.ts (RPC line) but may not have been applied via migration.
CREATE OR REPLACE FUNCTION public.expire_soft_bookings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE bookings
  SET status              = 'cancelled',
      cancelled_at        = now(),
      cancellation_reason = 'offer_expired'
  WHERE status IN ('suggested', 'soft_booked')
    AND offer_expires_at IS NOT NULL
    AND offer_expires_at < now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_soft_bookings() TO authenticated;
