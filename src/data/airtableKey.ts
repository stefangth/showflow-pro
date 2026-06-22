import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface AirtableKeyStatus {
  present: boolean;
  updatedAt: string | null;
}

/** Store the org's Airtable PAT in the Vault (write-only; never read back to the client). */
export async function saveAirtableKey(
  client: SupabaseClient<Database>,
  orgId: string,
  key: string,
): Promise<void> {
  const { error } = await client.rpc("set_org_airtable_key", { _org: orgId, _key: key });
  if (error) throw error;
}

/** Whether a key is stored + when it was last updated. Never returns the key value. */
export async function fetchAirtableKeyStatus(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<AirtableKeyStatus> {
  const { data, error } = await client.rpc("get_org_airtable_key_status", { _org: orgId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { present: !!row?.present, updatedAt: row?.updated_at ?? null };
}

/** Remove the org's stored Airtable PAT from the Vault. */
export async function deleteAirtableKey(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_org_airtable_key", { _org: orgId });
  if (error) throw error;
}
