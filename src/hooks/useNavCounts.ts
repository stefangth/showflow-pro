import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useFeature } from "@/hooks/useEntitlements";
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "@/data/bookings";
import { fetchAwaitingCountersignCount } from "@/data/hireOrders";

/**
 * Real, role-specific counts for sidebar nav badges.
 * - pendingConfirmations: soft_booked bookings awaiting a producer/admin (current org).
 * - openOffers: suggested bookings awaiting the signed-in artist's response.
 * - awaitingCountersign: hire orders (current org) sitting in 'issued' status.
 * Booking counts live under the ['bookings', ...] key domain so booking
 * mutations refresh them; the hire-order count lives under ['hire-orders', ...]
 * so hire-order mutations (the whole-prefix invalidation rule) refresh it.
 */
export function useNavCounts(): { pendingConfirmations: number; openOffers: number; awaitingCountersign: number } {
  const { currentOrg, hasRole } = useAuth();
  const { data: artist } = useMyArtist();
  const hasHireOrders = useFeature("hire_orders");
  const hasBookingFlow = useFeature("booking_flow");

  const orgId = currentOrg?.id ?? null;
  const canSeeOrgBookings = hasRole("admin") || hasRole("producer");
  const artistId = artist?.id ?? null;

  const pending = useQuery({
    queryKey: ["bookings", "nav-pending-confirmations", orgId],
    enabled: canSeeOrgBookings && !!orgId && hasBookingFlow,
    // Badge freshness without hammering on every focus/navigation; booking
    // mutations still invalidate ['bookings'] for immediate updates.
    staleTime: 60_000,
    queryFn: () => fetchPendingConfirmationsCount(supabase, orgId!),
  });

  const offers = useQuery({
    queryKey: ["bookings", "nav-open-offers", artistId],
    enabled: !!artistId && hasBookingFlow,
    staleTime: 60_000,
    queryFn: () => fetchMyOpenOffersCount(supabase, artistId!),
  });

  const awaitingCountersign = useQuery({
    queryKey: ["hire-orders", "awaiting-count", orgId],
    enabled: canSeeOrgBookings && !!orgId && hasHireOrders,
    staleTime: 60_000,
    queryFn: () => fetchAwaitingCountersignCount(supabase, orgId!),
  });

  return {
    pendingConfirmations: pending.data ?? 0,
    openOffers: offers.data ?? 0,
    awaitingCountersign: awaitingCountersign.data ?? 0,
  };
}
