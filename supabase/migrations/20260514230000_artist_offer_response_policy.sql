-- Allow artists to accept or decline their own suggested offers.
-- USING: can only touch rows they own that are still in 'suggested' state.
-- WITH CHECK: the updated row must be either soft_booked (accept) or cancelled (decline).
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
  AND status IN ('soft_booked', 'cancelled')
);
