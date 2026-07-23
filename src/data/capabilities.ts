import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CapabilityRow, CapabilityPolicyRow } from "@/lib/capabilities";

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

/** The org's platform-policy rows (capability + enabled + locked). */
export async function fetchCapabilityPolicies(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<CapabilityPolicyRow[]> {
  const { data, error } = await client
    .from("org_capability_policies")
    .select("capability, enabled, locked")
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as CapabilityPolicyRow[];
}

/** Both layers in one call: org overrides + platform policies. */
export async function fetchCapabilityState(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<{ overrides: CapabilityRow[]; policies: CapabilityPolicyRow[] }> {
  const [overrides, policies] = await Promise.all([
    fetchCapabilities(client, orgId),
    fetchCapabilityPolicies(client, orgId),
  ]);
  return { overrides, policies };
}
