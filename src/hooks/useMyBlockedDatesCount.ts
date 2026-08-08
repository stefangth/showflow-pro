import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchMyBlockedDatesCount } from '@/data/blockedDates';

/**
 * Count of the current artist's own blocked_dates rows. Uses its own `count`
 * projection sub-key under the shared `['blocked-dates']` invalidation prefix
 * (NOT the same key as AvailabilityPage's full-row read at
 * `['blocked-dates', artistId]`) — the two queryFns return different shapes
 * (a number here vs. `{ id, date, reason }[]` there), and React Query stores
 * one cached value per key, so sharing the key would let whichever query
 * populates the cache first silently clobber the other's shape. Keeping the
 * `['blocked-dates']` prefix means the existing "mutations that write to
 * blocked_dates invalidate ['blocked-dates']" rule still refreshes this too.
 */
export function useMyBlockedDatesCount(artistId: string | null) {
  return useQuery({
    queryKey: ['blocked-dates', 'count', artistId],
    enabled: !!artistId,
    queryFn: () => fetchMyBlockedDatesCount(supabase, { artistId: artistId! }),
  });
}
