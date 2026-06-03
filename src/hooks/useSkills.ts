import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchSkills, fetchArtistSkills, createSkill, type Skill } from '@/data/skills';

export type { Skill };

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => fetchSkills(supabase),
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
  return useMutation({
    mutationFn: (name: string) => createSkill(supabase, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}
