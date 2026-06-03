import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { NestedSlotDefaults } from "@/hooks/useSubProgramSlots";
import { dedupeProgramPairs, type ProgramPair } from "@/lib/settings";

/** Distinct (program, sub_program) pairs across all shows. */
export async function fetchProgramSubProgramPairs(
  client: SupabaseClient<Database>,
): Promise<ProgramPair[]> {
  const { data, error } = await client
    .from("shows")
    .select("program, sub_program")
    .not("program", "is", null)
    .not("sub_program", "is", null);
  if (error) throw error;
  return dedupeProgramPairs(data ?? []);
}

/** The sub_program_slots_defaults app_settings value (or {}). */
export async function fetchSlotDefaults(
  client: SupabaseClient<Database>,
): Promise<NestedSlotDefaults> {
  const { data, error } = await client
    .from("app_settings")
    .select("value")
    .eq("key", "sub_program_slots_defaults")
    .maybeSingle();
  if (error) throw error;
  return (data?.value ?? {}) as NestedSlotDefaults;
}
