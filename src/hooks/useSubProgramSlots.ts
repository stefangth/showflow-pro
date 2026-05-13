import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SubProgramSlotConfig {
  main_cast: number;
  understudies: number;
}

export function useSubProgramSlots(): Record<string, SubProgramSlotConfig> {
  const { data } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'sub_program_slots_defaults')
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as Record<string, SubProgramSlotConfig>;
    },
  });
  return data ?? {};
}

/** Returns null when the sub_program has no config — callers must handle this as "unconfigured". */
export function effectiveSlots(
  slotDefaults: Record<string, SubProgramSlotConfig>,
  subProgram: string | null
): SubProgramSlotConfig | null {
  if (subProgram && slotDefaults[subProgram] != null) return slotDefaults[subProgram];
  return null;
}
