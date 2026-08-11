import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import {
  fetchSkills,
  fetchArtistSkills,
  createSkill,
  fetchSkillCatalog,
  renameSkill,
  archiveSkill,
  restoreSkill,
  deleteSkill,
  fetchUpcomingDateCountsBySkill,
  type Skill,
  type SkillCatalogRow,
} from '@/data/skills';
import { toDateKey } from '@/lib/dates';

export type { Skill, SkillCatalogRow };

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

/** The org's full skill catalog (including archived) with usage counts — powers
 *  Settings -> Casts & Cities -> Skills. */
export function useSkillCatalog() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', 'catalog', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchSkillCatalog(supabase, currentOrg?.id ?? null),
  });
}

/** Shared mutation shape for the single-id skill lifecycle actions: every one
 *  busts the whole `['skills']` domain (catalog, pickers, artist-skill lists). */
function useSkillMutation<T>(fn: (id: string) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}

export const useArchiveSkill = () => useSkillMutation((id: string) => archiveSkill(supabase, id));
export const useRestoreSkill = () => useSkillMutation((id: string) => restoreSkill(supabase, id));
export const useDeleteSkill = () => useSkillMutation((id: string) => deleteSkill(supabase, id));

export function useRenameSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSkill(supabase, id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  });
}

/** Per skill, the count of upcoming non-cancelled dates that require it — the
 *  "N upcoming dates" metadata on the artist-profile skill rows. */
export function useUpcomingDateCountsBySkill() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', 'upcoming-date-counts', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchUpcomingDateCountsBySkill(supabase, currentOrg?.id ?? null, toDateKey(new Date())),
  });
}
