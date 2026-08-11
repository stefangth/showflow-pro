import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchTierCastMap, fetchTierLadderCounts } from '@/data/tierLadder';

/** The tier -> cast(s) map for a (show, city). Feeds `resolveNextOfferTarget`
 *  and the tier ladder card's cast labels. */
export function useTierCastMap(showId: string | null | undefined, cityId: string | null | undefined) {
  return useQuery({
    queryKey: ['tier-ladder', 'casts', showId, cityId],
    enabled: !!showId && !!cityId,
    queryFn: () => fetchTierCastMap(supabase, { showId: showId!, cityId: cityId ?? null }),
  });
}

/** Per-tier headcounts (castTotal/matchCount/missingSkillCount/blockedCount/
 *  alreadyOfferedCount) for a show date's tier ladder. */
export function useTierLadderCounts(
  showId: string | null | undefined,
  showDateId: string | null | undefined,
  cityId: string | null | undefined,
  orgId: string | null | undefined,
) {
  return useQuery({
    queryKey: ['tier-ladder', 'counts', showDateId, cityId],
    enabled: !!showId && !!showDateId,
    queryFn: () => fetchTierLadderCounts(supabase, {
      showId: showId!, showDateId: showDateId!, cityId: cityId ?? null, orgId: orgId ?? null,
    }),
  });
}
