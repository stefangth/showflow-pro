import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";

export interface OrgMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
}

/** Members of an org (admin-only RPC; aggregates a user's roles). */
export async function fetchOrgMembers(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgMember[]> {
  const { data, error } = await client.rpc("list_org_members", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as unknown as OrgMember[];
}

/** Remove a member from an org (admin-only RPC; guards last-admin + self). */
export async function removeOrgMember(
  client: SupabaseClient<Database>,
  orgId: string,
  userId: string,
): Promise<void> {
  const { error } = await client.rpc("remove_org_member", { p_org: orgId, p_user: userId });
  if (error) throw error;
}
