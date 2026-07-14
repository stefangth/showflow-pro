-- PR #161 external code review (round 3): close the booking retarget exploit.
--
-- Exploit being closed: the "Artists can respond to own offers" UPDATE policy
-- constrains artist_id ownership and status, but never pins show_date_id. An
-- artist owning a 'suggested' booking could therefore run
--   UPDATE bookings SET show_date_id = <any same-org date>, status = 'soft_booked'
-- (allowed in ANY org; the soft_booked half predates this branch) or
--   UPDATE bookings SET show_date_id = <any same-org date>, status = 'confirmed'
-- (in a producer_confirmation=false org), hijacking themselves onto an arbitrary
-- date and bypassing eligibility, capacity, and producer review. trg_derive_org_id
-- only rejects CROSS-org retargets, so a same-org retarget slipped through.
--
-- Fix: refs (show_date_id, artist_id) are immutable after creation. No production
-- code path updates either column post-INSERT: accept/decline and expiry touch
-- status columns, understudy promotion touches status/is_understudy/confirmed_at,
-- and every open/close/escalation write targets status or the offer_tiers table.
-- So a hard immutability guard breaks nothing legitimate while closing the hijack.
--
-- This is a BELT-AND-SUSPENDERS layer alongside trg_derive_org_id, which stays as
-- is (it still derives org_id on INSERT and rejects cross-org retargets as
-- defense-in-depth). The guard is role-independent: it fires for every UPDATE of
-- the ref columns regardless of RLS, so even a service-role or superuser write
-- cannot silently move a booking to a different date or artist.

CREATE OR REPLACE FUNCTION public.enforce_booking_immutable_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.show_date_id IS DISTINCT FROM OLD.show_date_id
     OR NEW.artist_id IS DISTINCT FROM OLD.artist_id
  THEN
    RAISE EXCEPTION 'bookings.show_date_id and bookings.artist_id are immutable after creation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_booking_immutable_refs ON public.bookings;
CREATE TRIGGER enforce_booking_immutable_refs
BEFORE UPDATE OF show_date_id, artist_id ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_immutable_refs();
