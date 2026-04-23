import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import type { Artist } from '@/types';

/** Returns the `artists` row linked to the current auth user (or null). */
export function useMyArtist() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-artist', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('artists')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as Artist | null) ?? null;
    },
  });
}
