import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type Skill = { id: string; name: string };

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: async (): Promise<Skill[]> => {
      const { data, error } = await supabase
        .from('skills')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useArtistSkills(artistId: string | null | undefined) {
  return useQuery({
    queryKey: ['skills', 'for-artist', artistId],
    enabled: !!artistId,
    queryFn: async (): Promise<Skill[]> => {
      const { data, error } = await supabase
        .from('artist_skills')
        .select('skill:skills(id, name)')
        .eq('artist_id', artistId!);
      if (error) throw error;
      return ((data ?? []) as unknown as { skill: Skill }[])
        .map((r) => r.skill)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Skill> => {
      const trimmed = name.trim();
      const { data, error } = await supabase
        .from('skills')
        .insert({ name: trimmed })
        .select('id, name')
        .single();
      if (error) throw error;
      return data as Skill;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}
