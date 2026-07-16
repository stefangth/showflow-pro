import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { EntitlementRow } from "@/lib/entitlements";

/** The org's feature entitlement rows (feature + enabled only). */
export async function fetchEntitlements(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<EntitlementRow[]> {
  const { data, error } = await client
    .from("org_entitlements")
    .select("feature, enabled")
    .eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}
