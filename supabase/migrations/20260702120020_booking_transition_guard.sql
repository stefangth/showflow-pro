-- H3 — Enforce legal booking status transitions at the database.
--
-- Producer/admin write paths (DashboardPage bulkConfirm/bulkDecline,
-- ShowDateDetailSheet.updateBookingStatus) run unguarded UPDATEs with no status
-- precondition, so a stale selection can resurrect a cancelled booking
-- (cancelled → confirmed) after expire-offers / a date-cancellation cascade already
-- cancelled it. Only artist transitions were RLS-guarded; producer transitions had
-- no state-machine enforcement. This adds a BEFORE UPDATE OF status trigger that
-- RAISEs on any illegal (OLD.status → NEW.status) transition. Client guards
-- (defense in depth) land alongside this migration.
--
-- Legal transitions (OLD → NEW):
--   suggested   → soft_booked | cancelled
--   soft_booked → confirmed   | cancelled
--   confirmed   → cancelled
--   cancelled   → (nothing — a cancelled booking is terminal)
-- Same-status writes (NEW.status = OLD.status) always pass so that updates to other
-- columns (notes, timestamps, is_understudy, offer_expires_at, …) and idempotent
-- re-writes of the same status are never blocked.
--
-- Coverage of every existing bookings.status write path (all within the legal set):
--   * expire_soft_bookings() RPC (20260702120002)          suggested → cancelled      ✓
--   * close-offer-tier edge fn                             suggested → cancelled      ✓
--   * open-offer-tier / ShowDateDetailSheet.createBooking  INSERT (not UPDATE)        ✓
--   * cascade_cancel_bookings_on_date_cancel (20260620130000)  {any} → cancelled      ✓
--   * promote_understudy_on_cancellation (20260702120003)  soft_booked → confirmed    ✓
--   * slot-fill auto-cancel (20260616203749)               {suggested,soft_booked} → cancelled ✓
--   * OfferResponseButtons (artist)                        suggested → {soft_booked,cancelled} ✓
--   * DashboardPage bulkConfirm / bulkDecline              soft_booked → {confirmed,cancelled} ✓
--   * ShowDateDetailSheet.updateBookingStatus              soft_booked → confirmed; {soft_booked,confirmed} → cancelled ✓
--
-- Understudy promotion: its only transition is soft_booked → confirmed
-- (promote_understudy_on_cancellation, 20260702120003 — candidates are always
-- soft_booked and are set to confirmed), which is already legal under the explicit
-- rules below. No GUC bypass is needed; the earlier app.promoting_understudy escape
-- hatch was redundant and has been removed. If the promotion path ever introduces a
-- transition outside the legal set, add that transition to the state machine here.
--
-- This does NOT touch the existing notify_booking_transition AFTER-UPDATE audit
-- trigger — it is a separate, additive BEFORE-UPDATE trigger.

CREATE OR REPLACE FUNCTION public.enforce_booking_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Non-status column updates and same-status writes always pass.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- State machine: raise on anything outside the legal set.
  IF (OLD.status = 'suggested'::booking_status
        AND NEW.status IN ('soft_booked'::booking_status, 'cancelled'::booking_status))
     OR (OLD.status = 'soft_booked'::booking_status
        AND NEW.status IN ('confirmed'::booking_status, 'cancelled'::booking_status))
     OR (OLD.status = 'confirmed'::booking_status
        AND NEW.status = 'cancelled'::booking_status)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'illegal booking status transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS enforce_booking_transition_trigger ON public.bookings;
CREATE TRIGGER enforce_booking_transition_trigger
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_transition();
