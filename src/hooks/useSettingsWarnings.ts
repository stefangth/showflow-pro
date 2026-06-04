import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { computeSchedulingWarnings, type SettingsWarnings } from '@/lib/settings';
import { fetchProgramSubProgramPairs, fetchSlotDefaults } from '@/data/settings';

export type { SettingsWarnings };

export function useSettingsWarnings(): SettingsWarnings {
  const { hasRole, currentOrg } = useAuth();
  const canView = hasRole('admin') || hasRole('producer');
  const orgId = currentOrg?.id ?? null;

  const { data: pairs } = useQuery({
    queryKey: ['shows-program-sub-programs'],
    enabled: canView,
    queryFn: () => fetchProgramSubProgramPairs(supabase),
    staleTime: 60_000,
  });

  const { data: slotsSetting } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults', orgId],
    enabled: canView,
    queryFn: () => fetchSlotDefaults(supabase, orgId),
    staleTime: 30_000,
  });

  return useMemo(
    () => computeSchedulingWarnings(pairs, slotsSetting),
    [pairs, slotsSetting],
  );
}
