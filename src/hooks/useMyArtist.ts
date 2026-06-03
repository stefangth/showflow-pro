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
    queryFn: () => fetchMyArtist(supabase, userId!),
  });
}
