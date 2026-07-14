-- Auto-confirm acceptance: when the org's booking_flow disables producer
-- confirmation, an artist accepting an offer confirms it in one step.
-- The confirmed branch is gated server-side on the org's own setting via
-- get_org_setting (SECURITY DEFINER, STABLE), so artists in orgs with
-- producer review enabled still cannot self-confirm. The flow is resolved
-- from the booking's show_date's org (not the row's own, client-writable
-- org_id column) so a tampered row org_id cannot borrow another org's
-- setting — changing show_date_id instead re-fires trg_derive_org_id,
-- which re-derives and re-checks org_id from the new show_date.
DROP POLICY IF EXISTS "Artists can respond to own offers" ON public.bookings;
CREATE POLICY "Artists can respond to own offers"
ON public.bookings FOR UPDATE
TO authenticated
USING (
  artist_id IN (
    SELECT id FROM public.artists WHERE user_id = auth.uid()
  )
  AND status = 'suggested'
)
WITH CHECK (
  artist_id IN (
    SELECT id FROM public.artists WHERE user_id = auth.uid()
  )
  AND (
    status IN ('soft_booked', 'cancelled')
    OR (
      status = 'confirmed'
      AND COALESCE(
        (public.get_org_setting(
          (SELECT sd.org_id FROM public.show_dates sd WHERE sd.id = show_date_id),
          'booking_flow')->>'producer_confirmation')::boolean,
        true
      ) = false
    )
  )
);
