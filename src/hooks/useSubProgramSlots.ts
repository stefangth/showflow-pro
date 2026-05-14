import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SubProgramSlotConfig {
  main_cast: number;
  understudies: number;
}

/**
 * Nested slot defaults: { [program]: { [sub_program]: { main_cast, understudies } } }.
 * Stored in app_settings.sub_program_slots_defaults.
 */
export type NestedSlotDefaults = Record<string, Record<string, SubProgramSlotConfig>>;

export function useSubProgramSlots(): NestedSlotDefaults {
  const { data } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'sub_program_slots_defaults')
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as NestedSlotDefaults;
    },
  });
  return data ?? {};
}

/**
 * Returns null when (program, sub_program) has no config or when both thresholds
 * are 0 — callers must treat null as "unconfigured" (matches DB trigger behaviour).
 */
export function effectiveSlots(
  slotDefaults: NestedSlotDefaults,
  program: string | null | undefined,
  subProgram: string | null | undefined,
): SubProgramSlotConfig | null {
  if (!program || !subProgram) return null;
  const cfg = slotDefaults?.[program]?.[subProgram] ?? null;
  if (cfg && cfg.main_cast === 0 && cfg.understudies === 0) return null;
  return cfg;
}
