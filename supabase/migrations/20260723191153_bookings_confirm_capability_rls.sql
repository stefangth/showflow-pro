-- Plan 3, Phase 1.9c (HIGH RISK): transition-gated write RLS on bookings.
-- The old "Admins and producers can manage bookings" FOR ALL policy (check
-- defaulted to using = admin OR producer) is split so that a producer WRITE that
-- lands a booking in 'confirmed' requires producer_can_confirm_bookings, while
-- every other producer write (suggest/soft-book/cancel/decline/delete) and all
-- producer READS are unchanged. Admin is always allowed. The artist self-response
-- policy ("Artists can respond to own offers") and org_isolation are untouched.
-- Covers single confirm, bulk confirm, and direct-book-as-confirmed (all land 'confirmed').
drop policy "Admins and producers can manage bookings" on public.bookings;

create policy "Admins manage bookings" on public.bookings for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));

create policy "Producers manage bookings" on public.bookings for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and (status <> 'confirmed'::booking_status
         or public.is_capability_enabled(org_id, 'producer_can_confirm_bookings'))
  );
