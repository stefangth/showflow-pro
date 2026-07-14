-- PR #161 external code review (round 2): DB-layer enforcement of the booking_flow
-- pairing invariant.
--
-- The invariant "artist_acceptance=false forces producer_confirmation=true" (a
-- direct-booking org has no offer/accept stage, so acceptance cannot also be off) lived
-- only in the TypeScript normalize layer (normalizeBookingFlow in
-- src/lib/bookingFlow.ts / supabase/functions/_shared/bookingFlow.ts). The self-confirm
-- RLS policy ("Artists can respond to own offers") reads the RAW stored JSON via
-- get_org_setting, so a booking_flow row written with both flags false (bypassing the TS
-- layer) could leave the invariant violated at the point the policy evaluates it.
--
-- This trigger mirrors the normalize semantics at the DB boundary: it COERCES (does not
-- reject - the TS layer coerces too) a booking_flow value that has both artist_acceptance
-- and producer_confirmation exactly 'false' by forcing producer_confirmation back to true.
-- Absent producer_confirmation is treated as its default 'true' (no coercion needed).
--
-- Trigger ordering: this is a BEFORE INSERT OR UPDATE trigger (it mutates NEW). The
-- Task-4 audit trigger log_app_settings_change on app_settings is AFTER INSERT OR UPDATE,
-- so it records the already-healed value - the audit log reflects what was stored, not the
-- raw pre-coercion input. No SECURITY DEFINER is needed (a BEFORE trigger mutating NEW
-- requires no elevated writes); search_path is pinned per repo convention.

CREATE OR REPLACE FUNCTION public.enforce_booking_flow_pairing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.key = 'booking_flow'
     AND jsonb_typeof(NEW.value) = 'object'
     AND lower(NEW.value->>'artist_acceptance') = 'false'
     AND lower(COALESCE(NEW.value->>'producer_confirmation', 'true')) = 'false'
  THEN
    NEW.value = jsonb_set(NEW.value, '{producer_confirmation}', 'true'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_booking_flow_pairing
BEFORE INSERT OR UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_flow_pairing();
