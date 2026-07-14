-- Auto-confirm acceptance: when the org's booking_flow disables producer
-- confirmation, an artist accepting an offer confirms it in one step.
-- The confirmed branch is gated server-side on the org's own setting via
-- get_org_setting (SECURITY DEFINER, STABLE), so artists in orgs with
-- producer review enabled still cannot self-confirm.
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
        (public.get_org_setting(org_id, 'booking_flow')->>'producer_confirmation')::boolean,
        true
      ) = false
    )
  )
);
