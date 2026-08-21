import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useFeature } from "@/hooks/useEntitlements";
import { useNeedsYouCount } from "@/hooks/useNeedsYouCount";
import { fetchMyOpenOffersCount } from "@/data/bookings";
import { fetchAwaitingCountersignCount } from "@/data/hireOrders";

/**
 * Real, role-specific counts for sidebar nav badges.
 * - needsYou: the org-wide "Needs you" total the Shows & Bookings ("Dates") page shows —
 *   the same four-bucket derivation (see useNeedsYouCount), so the badge and the page agree.
 * - openOffers: suggested bookings awaiting the signed-in artist's response.
 * - awaitingCountersign: hire orders (current org) sitting in 'issued' status.
 * Booking counts live under the ['bookings', ...] key domain so booking
 * mutations refresh them; the hire-order count lives under ['hire-orders', ...]
 * so hire-order mutations (the whole-prefix invalidation rule) refresh it.
 */
export function useNavCounts(): { needsYou: number; openOffers: number; awaitingCountersign: number; isLoading: boolean } {
  const { currentOrg, hasRole } = useAuth();
  const { data: artist } = useMyArtist();
  const hasHireOrders = useFeature("hire_orders");
  const hasBookingFlow = useFeature("booking_flow");

  const orgId = currentOrg?.id ?? null;
  const canSeeOrgBookings = hasRole("admin") || hasRole("producer");
  const artistId = artist?.id ?? null;

  const needsYou = useNeedsYouCount({
    orgId,
    enabled: canSeeOrgBookings && hasBookingFlow,
    hireOrdersOn: hasHireOrders,
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

  // Gate the VALUES, not just `enabled`. booking_flow is default-on, so useFeature
  // reports true while entitlements load and the booking query fires and resolves;
  // flipping `enabled` to false afterwards does not evict what React Query already
  // cached, so an unentitled org would keep rendering a live count next to a locked
  // nav item. (needsYou already applies the same gate internally via its `enabled`
  // arg AND returns 0 when off; hire_orders is default-off, so its query never fires
  // during loading and does not need the same treatment.)
  return {
    needsYou,
    openOffers: hasBookingFlow ? (offers.data ?? 0) : 0,
    awaitingCountersign: awaitingCountersign.data ?? 0,
    isLoading: offers.isLoading || awaitingCountersign.isLoading,
  };
}
