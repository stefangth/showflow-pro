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
 * - awaitingCountersign: issued hire orders awaiting the artist's countersignature
 *   (current org) — the "Hire orders" nav item's badge.
 * pendingConfirmations/openOffers live under ['bookings', ...] so booking mutations
 * refresh them; awaitingCountersign lives under ['hire-orders', ...] for the same reason.
 *
 * awaitingCountersign is additionally gated on the org's `hire_orders` entitlement,
 * mirroring the nav item that consumes it (visibleNavItems in navItems.ts):
 * super-admins bypass the gate (god-mode), everyone else needs the feature enabled.
 * The feature ships dark, so without this gate every admin/producer would fire an
 * extra round-trip on every page load for orgs that don't have hire orders at all.
 */
export function useNavCounts(): { pendingConfirmations: number; openOffers: number; awaitingCountersign: number } {
  const { currentOrg, hasRole, isSuperAdmin } = useAuth();
  const { data: artist } = useMyArtist();
  const hireOrdersEnabled = useFeature("hire_orders");

  const orgId = currentOrg?.id ?? null;
  const canSeeOrgBookings = hasRole("admin") || hasRole("producer");
  const artistId = artist?.id ?? null;

  const pending = useQuery({
    queryKey: ["bookings", "nav-pending-confirmations", orgId],
    enabled: canSeeOrgBookings && !!orgId,
    // Badge freshness without hammering on every focus/navigation; booking
    // mutations still invalidate ['bookings'] for immediate updates.
    staleTime: 60_000,
    queryFn: () => fetchPendingConfirmationsCount(supabase, orgId!),
  });

  const offers = useQuery({
    queryKey: ["bookings", "nav-open-offers", artistId],
    enabled: !!artistId,
    staleTime: 60_000,
    queryFn: () => fetchMyOpenOffersCount(supabase, artistId!),
  });

  const awaitingCountersign = useQuery({
    queryKey: ["hire-orders", "awaiting-count", orgId],
    enabled: canSeeOrgBookings && !!orgId && (hireOrdersEnabled || isSuperAdmin),
    staleTime: 60_000,
    queryFn: () => fetchAwaitingCountersignCount(supabase, orgId!),
  });

  return {
    pendingConfirmations: pending.data ?? 0,
    openOffers: offers.data ?? 0,
    awaitingCountersign: awaitingCountersign.data ?? 0,
  };
}
