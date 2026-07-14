-- Booking flow (Milestone B): allow suggested → confirmed + add bookings.reminder_sent_at.
--
-- suggested → confirmed becomes legal: artist acceptance under
-- booking_flow.producer_confirmation=false confirms in one step.
-- reminder_sent_at: idempotency stamp for the offer expiry reminder.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Re-declare public.enforce_booking_transition() (originally defined in
-- 20260702120020_booking_transition_guard.sql) with 'confirmed' added to the
-- suggested branch of the legal set. CREATE OR REPLACE updates the function in
-- place; the existing enforce_booking_transition_trigger keeps calling it, so the
-- trigger binding is intentionally NOT re-created here.
--
-- Legal transitions (OLD → NEW):
--   suggested   → soft_booked | confirmed | cancelled
--   soft_booked → confirmed   | cancelled
--   confirmed   → cancelled
--   cancelled   → (nothing — a cancelled booking is terminal)
--
-- Note: this loosens only the database state machine. Direct artist self-confirm
-- stays blocked by the "Artists can respond to own offers" RLS WITH CHECK
-- (soft_booked | cancelled only); auto-confirm acceptance runs through a
-- server-side (SECURITY DEFINER) write path added in a later task.

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
        AND NEW.status IN ('soft_booked'::booking_status, 'confirmed'::booking_status, 'cancelled'::booking_status))
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
