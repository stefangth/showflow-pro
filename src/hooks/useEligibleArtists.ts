import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resolves the set of artist IDs eligible for a given show date.
 * Eligible = members of (show+city eligible casts) ∪ (per-date overrides).
 * If no eligibility config exists at all, returns null (meaning "no restriction").
 */
export function useEligibleArtists(showId: string | null | undefined, showDateId: string | null | undefined, cityId: string | null | undefined) {
  return useQuery({
    queryKey: ['eligible-artists', showId, showDateId, cityId],
    enabled: !!showId && !!showDateId,
    queryFn: async (): Promise<{ artistIds: Set<string> | null; castIds: string[] }> => {
      const castIds: string[] = [];

      if (cityId) {
        const { data: showCasts } = await supabase
          .from('show_cast_eligibility')
          .select('cast_id')
          .eq('show_id', showId!)
          .eq('city_id', cityId);
        showCasts?.forEach(r => castIds.push(r.cast_id));
      }

      const { data: dateCasts } = await supabase
        .from('show_date_cast_eligibility')
        .select('cast_id')
        .eq('show_date_id', showDateId!);
      dateCasts?.forEach(r => castIds.push(r.cast_id));

      const uniqCastIds = Array.from(new Set(castIds));
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
