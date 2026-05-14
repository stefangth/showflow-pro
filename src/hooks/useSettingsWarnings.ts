import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import type { NestedSlotDefaults } from './useSubProgramSlots';

export interface SettingsWarnings {
  /** Number of (program, sub_program) combinations with no slot defaults configured */
  schedulingWarnings: number;
  /** True when any warning exists across all settings tabs */
  hasAnyWarning: boolean;
}

export function useSettingsWarnings(): SettingsWarnings {
  const { hasRole } = useAuth();
  const canView = hasRole('admin') || hasRole('producer');

  const { data: pairs } = useQuery({
    queryKey: ['shows-program-sub-programs'],
    enabled: canView,
    queryFn: async () => {
      const { data } = await supabase
        .from('shows')
        .select('program, sub_program')
        .not('program', 'is', null)
        .not('sub_program', 'is', null);
      const seen = new Set<string>();
      const out: { program: string; sub_program: string }[] = [];
      (data ?? []).forEach(r => {
        const key = `${r.program}::${r.sub_program}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ program: r.program as string, sub_program: r.sub_program as string });
        }
      });
      return out;
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
      return (data?.value ?? {}) as NestedSlotDefaults;
    },
    staleTime: 30_000,
  });

  return useMemo(() => {
    const unconfigured = (pairs ?? []).filter(p => !slotsSetting?.[p.program]?.[p.sub_program]);
    const schedulingWarnings = unconfigured.length;
    return { schedulingWarnings, hasAnyWarning: schedulingWarnings > 0 };
  }, [pairs, slotsSetting]);
}
