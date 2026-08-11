import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";

export interface OrgMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
  last_sign_in_at: string | null;
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

/** How many producer-role members the org has (org_memberships is readable by any org
 *  member, so this needs no admin RPC). One row per (user, role), so this counts distinct
 *  producer memberships. */
export async function fetchProducerCount(client: SupabaseClient<Database>, orgId: string): Promise<number> {
  const { count, error } = await client
    .from("org_memberships")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "producer");
  if (error) throw error;
  return count ?? 0;
}

/** Add or remove a single role for a member (admin-only RPC; guards the last admin). */
export async function setOrgMemberRole(
  client: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  role: AppRole,
  action: "add" | "remove",
): Promise<void> {
  const { error } = await client.rpc("set_org_member_role", {
    p_org: orgId, p_user: userId, p_role: role, p_action: action,
  });
  if (error) throw error;
}
