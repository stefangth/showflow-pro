import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { fetchSkills, fetchArtistSkills, createSkill, type Skill } from '@/data/skills';

export type { Skill };

export function useSkills() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchSkills(supabase, currentOrg?.id ?? null),
  });
}

export function useArtistSkills(artistId: string | null | undefined) {
  return useQuery({
    queryKey: ['skills', 'for-artist', artistId],
    enabled: !!artistId,
    queryFn: () => fetchArtistSkills(supabase, artistId!),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  const { currentOrg } = useAuth();
  return useMutation({
    mutationFn: (name: string) => {
      if (!currentOrg) throw new Error('No active organization');
      return createSkill(supabase, name, currentOrg.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}
