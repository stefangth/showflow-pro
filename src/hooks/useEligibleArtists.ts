import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchGateCastIds } from '@/data/eligibility';

/**
 * Resolves the set of artist IDs eligible for a given show date.
 * Eligible = members of (show+city eligible casts) ∪ (per-date overrides).
 * If no eligibility config exists at all, returns null (meaning "no restriction").
 * The cast-source resolution is shared with the tier-ladder gate via fetchGateCastIds.
 */
export function useEligibleArtists(showId: string | null | undefined, showDateId: string | null | undefined, cityId: string | null | undefined) {
  return useQuery({
    queryKey: ['eligible-artists', showId, showDateId, cityId],
    enabled: !!showId && !!showDateId,
    queryFn: async (): Promise<{ artistIds: Set<string> | null; castIds: string[] }> => {
      const uniqCastIds = await fetchGateCastIds(supabase, {
        showId: showId!, cityId: cityId ?? null, showDateId: showDateId!,
      });
      if (uniqCastIds.length === 0) {
        return { artistIds: null, castIds: [] };
      }

      const { data: members } = await supabase
        .from('cast_members')
        .select('artist_id')
        .in('cast_id', uniqCastIds);

      return {
        artistIds: new Set((members ?? []).map(m => m.artist_id)),
        castIds: uniqCastIds,
      };
    },
  });
}
