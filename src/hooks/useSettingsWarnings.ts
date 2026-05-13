import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import type { SubProgramSlotConfig } from './useSubProgramSlots';

export interface SettingsWarnings {
  /** Number of sub-programs with no slot defaults configured */
  schedulingWarnings: number;
  /** True when any warning exists across all settings tabs */
  hasAnyWarning: boolean;
}

export function useSettingsWarnings(): SettingsWarnings {
  const { hasRole } = useAuth();
  const canView = hasRole('admin') || hasRole('producer');

  const { data: subPrograms } = useQuery({
    queryKey: ['shows-sub-programs'],
    enabled: canView,
    queryFn: async () => {
      const { data } = await supabase
        .from('shows')
        .select('sub_program')
        .not('sub_program', 'is', null);
      return [...new Set((data ?? []).map(r => r.sub_program as string))].sort();
    },
    staleTime: 60_000,
  });

  const { data: slotsSetting } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults'],
    enabled: canView,
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'sub_program_slots_defaults')
        .maybeSingle();
      return (data?.value ?? {}) as Record<string, SubProgramSlotConfig>;
    },
    staleTime: 30_000,
  });

  return useMemo(() => {
    const unconfigured = (subPrograms ?? []).filter(sp => !slotsSetting?.[sp]);
    const schedulingWarnings = unconfigured.length;
    return { schedulingWarnings, hasAnyWarning: schedulingWarnings > 0 };
  }, [subPrograms, slotsSetting]);
}
