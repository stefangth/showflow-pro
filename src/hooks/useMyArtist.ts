import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, useEffectiveUserId } from '@/features/auth/AuthContext';
import { fetchMyArtist } from '@/data/artists';

/**
 * Returns the `artists` row linked to the current auth user (or impersonated user)
 * in the active org. The org is part of both the key and the query: one user can be
 * an artist in several orgs, so the linkage is per-org, not global.
 */
export function useMyArtist() {
  const userId = useEffectiveUserId();
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['my-artist', userId, currentOrg?.id],
    enabled: !!userId && !!currentOrg,
    // Artist↔user linkage is stable within a session; cache it so non-artist
    // users (admins/producers) don't re-query on every window focus/navigation.
    staleTime: 5 * 60_000,
    queryFn: () => fetchMyArtist(supabase, userId!, currentOrg?.id ?? null),
  });
}
