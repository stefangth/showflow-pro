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
  return data ?? [];
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

/** Delete an org's override for a capability (revert to platform/registry default). */
export async function clearOrgCapability(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
): Promise<void> {
  const { error } = await client.from("org_capabilities").delete().eq("org_id", orgId).eq("capability", capability);
  if (error) throw error;
}

/** Upsert a platform policy patch (enabled and/or locked) for a capability. Super-admin only via RLS. */
export async function setOrgCapabilityPolicy(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
  patch: { enabled?: boolean | null; locked?: boolean },
): Promise<void> {
  const { error } = await client
    .from("org_capability_policies")
    .upsert({ org_id: orgId, capability, ...patch }, { onConflict: "org_id,capability" });
  if (error) throw error;
}

/** Delete a capability's platform policy row (clear platform default + unlock). Super-admin only via RLS. */
export async function clearOrgCapabilityPolicy(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
): Promise<void> {
  const { error } = await client.from("org_capability_policies").delete().eq("org_id", orgId).eq("capability", capability);
  if (error) throw error;
}
