import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveUserId } from '@/features/auth/AuthContext';
import { fetchMyArtist } from '@/data/artists';

/** Returns the `artists` row linked to the current auth user (or impersonated user). */
export function useMyArtist() {
  const userId = useEffectiveUserId();
  return useQuery({
    queryKey: ['my-artist', userId],
    enabled: !!userId,
    // Artist↔user linkage is stable within a session; cache it so non-artist
    // users (admins/producers) don't re-query on every window focus/navigation.
    staleTime: 5 * 60_000,
    queryFn: () => fetchMyArtist(supabase, userId!),
  });
}
