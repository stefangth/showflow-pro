import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "@/data/bookings";

/**
 * Real, role-specific counts for sidebar nav badges.
 * - pendingConfirmations: soft_booked bookings awaiting a producer/admin (current org).
 * - openOffers: suggested bookings awaiting the signed-in artist's response.
 * Both live under the ['bookings', ...] key domain so booking mutations refresh them.
 */
export function useNavCounts(): { pendingConfirmations: number; openOffers: number } {
  const { currentOrg, hasRole } = useAuth();
  const { data: artist } = useMyArtist();

  const orgId = currentOrg?.id ?? null;
  const canSeeOrgBookings = hasRole("admin") || hasRole("producer");
  const artistId = artist?.id ?? null;

  const pending = useQuery({
    queryKey: ["bookings", "nav-pending-confirmations", orgId],
    enabled: canSeeOrgBookings && !!orgId,
    queryFn: () => fetchPendingConfirmationsCount(supabase, orgId!),
  });

  const offers = useQuery({
    queryKey: ["bookings", "nav-open-offers", artistId],
    enabled: !!artistId,
    queryFn: () => fetchMyOpenOffersCount(supabase, artistId!),
  });

  return {
    pendingConfirmations: pending.data ?? 0,
    openOffers: offers.data ?? 0,
  };
}
