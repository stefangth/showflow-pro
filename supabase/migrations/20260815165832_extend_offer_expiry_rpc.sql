-- Calendar Phase 2, Task 1: extend_offer_expiry RPC.
--
-- Backs the producer "Needs you" queue's "Extend 24h" action. PostgREST cannot
-- express a column-relative `offer_expires_at = offer_expires_at + interval`
-- update, so this is a thin SQL RPC. SECURITY INVOKER so RLS (org_isolation +
-- "Admins manage bookings" / "Producers manage bookings") and the caller's
-- actual role keep gating exactly which rows are affected — a non-member of
-- the show_date's org simply updates 0 rows, no special-casing needed here.
-- Only 'suggested' and 'soft_booked' bookings are pending offers; status is
-- never touched, so enforce_booking_transition (fires only OF status) never runs.
create or replace function public.extend_offer_expiry(
  p_show_date_id uuid,
  p_hours int
) returns integer
language sql
security invoker
set search_path = public
as $$
  with updated as (
    update public.bookings
       set offer_expires_at = coalesce(offer_expires_at, now()) + make_interval(hours => p_hours)
     where show_date_id = p_show_date_id
       and status in ('suggested','soft_booked')
    returning id
  )
  select count(*)::int from updated;
$$;

revoke all on function public.extend_offer_expiry(uuid, int) from public;
grant execute on function public.extend_offer_expiry(uuid, int) to authenticated;
