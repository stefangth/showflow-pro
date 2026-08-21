import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchBookingsWithArtistForDates } from "@/data/bookings";

/**
 * The "Needs you" queue's per-date people rows (`buildNeedsYouQueue`'s `people`
 * input) — every booking (any status) for a set of show_date ids, with the
 * artist name and offer expiry joined in. `dateIds` is caller-computed (see
 * `ShowsBookingsPage`'s queue-relevant id list); an empty list short-circuits
 * without querying.
 */
export function useBookingsWithArtist(
  orgId: string | null | undefined,
  dateIds: string[],
  options?: { staleTime?: number },
) {
  return useQuery({
    queryKey: ["bookings", "with-artist", orgId, dateIds],
    enabled: !!orgId && dateIds.length > 0,
    // Undefined by default → React Query's default (0), unchanged for existing callers.
    staleTime: options?.staleTime,
    queryFn: () => fetchBookingsWithArtistForDates(supabase, { orgId: orgId!, showDateIds: dateIds }),
  });
}
