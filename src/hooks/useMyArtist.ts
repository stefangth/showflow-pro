import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveUserId } from '@/features/auth/AuthContext';
import type { Artist } from '@/types';

/** Returns the `artists` row linked to the current auth user (or impersonated user). */
export function useMyArtist() {
  const userId = useEffectiveUserId();
  return useQuery({
    queryKey: ['my-artist', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('artists')
        .select('*')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Artist | null) ?? null;
    },
  });
}
