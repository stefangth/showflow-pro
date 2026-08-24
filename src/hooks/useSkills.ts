import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
  fetchSkillEligibilityGaps,
  setArtistSkills,
  type Skill,
  type SkillCatalogRow,
  type SkillGap,
} from '@/data/skills';
import { toDateKey } from '@/lib/dates';

export type { Skill, SkillCatalogRow, SkillGap };

export function useSkills(options?: { enabled?: boolean }) {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', currentOrg?.id],
    enabled: (options?.enabled ?? true) && !!currentOrg,
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

/** Bust both the skills domain (catalog rows, pickers, per-artist skill lists)
 *  and the artists-roster skill-badges domain (`['artist-skills', ...]`,
 *  ArtistsPage.tsx). A rename changes the name shown on the roster; archive
 *  /restore/delete change membership or visibility — both must invalidate the
 *  roster's own query, which lives outside the `['skills']` prefix. */
function bustSkillDomains(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['skills'] });
  qc.invalidateQueries({ queryKey: ['artist-skills'] });
}

/** Skills a part requires that no active artist holds. ONE hook, so the get-running board's
 *  `skills` step state and the panel that clears it read the same cache entry and can never
 *  disagree about what is still blocking. */
export function useSkillGaps(orgId: string | null, options?: { enabled?: boolean }) {
  return useQuery<SkillGap[]>({
    queryKey: ['skills', 'gaps', orgId],
    queryFn: () => fetchSkillEligibilityGaps(supabase, orgId),
    enabled: (options?.enabled ?? true) && !!orgId,
  });
}

/** Toggle skills on ONE artist. Busts the skills domain (which includes the gap query above,
 *  so a gap clears as soon as an artist picks the skill up) and the artists roster, whose
 *  active-artist read carries the per-artist skill ids this panel renders. */
export function useSetArtistSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { artistId: string; orgId: string; add: string[]; remove: string[] }) =>
      setArtistSkills(supabase, args),
    onSuccess: () => {
      bustSkillDomains(qc);
      qc.invalidateQueries({ queryKey: ['artists'] });
    },
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
    onSuccess: () => bustSkillDomains(qc),
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
    onSuccess: () => bustSkillDomains(qc),
  });
}

export const useArchiveSkill = () => useSkillMutation((id: string) => archiveSkill(supabase, id));
export const useRestoreSkill = () => useSkillMutation((id: string) => restoreSkill(supabase, id));
export const useDeleteSkill = () => useSkillMutation((id: string) => deleteSkill(supabase, id));

export function useRenameSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSkill(supabase, id, name),
    onSuccess: () => bustSkillDomains(qc),
  });
}

/** Per skill, the count of upcoming non-cancelled dates that require it — the
 *  "N upcoming dates" metadata on the artist-profile skill rows. `ArtistProfileSheet`
 *  stays mounted at all times on the Artists page (`open={!!profileArtistId}`), so
 *  callers pass `{ enabled: open }` to avoid firing this on every page load. */
export function useUpcomingDateCountsBySkill(options?: { enabled?: boolean }) {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ['skills', 'upcoming-date-counts', currentOrg?.id],
    enabled: (options?.enabled ?? true) && !!currentOrg,
    queryFn: () => fetchUpcomingDateCountsBySkill(supabase, currentOrg?.id ?? null, toDateKey(new Date())),
  });
}
