import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CapabilityRow } from "@/lib/capabilities";

/** The org's capability rows (capability + enabled only). */
export async function fetchCapabilities(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<CapabilityRow[]> {
  const { data, error } = await client
    .from("org_capabilities")
    .select("capability, enabled")
    .eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}
