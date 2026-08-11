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

export interface RemovedMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
  removed_at: string;
  removed_by_name: string | null;
  /** true when the user has no membership in any org — a full account delete is safe. */
  deletable: boolean;
}

/** Tombstones for an org's recently-removed members (admin-only RPC). */
export async function fetchRemovedMembers(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<RemovedMember[]> {
  const { data, error } = await client.rpc("list_removed_members", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as unknown as RemovedMember[];
}

/** Undo a removal: restore the membership + roles, drop the tombstone (admin-only RPC). */
export async function restoreOrgMember(
  client: SupabaseClient<Database>, orgId: string, userId: string,
): Promise<void> {
  const { error } = await client.rpc("restore_org_member", { p_org: orgId, p_user: userId });
  if (error) throw error;
}

/** Dismiss a tombstone from the list; account untouched (admin-only RPC). */
export async function clearRemovedMember(
  client: SupabaseClient<Database>, orgId: string, userId: string,
): Promise<void> {
  const { error } = await client.rpc("clear_removed_member", { p_org: orgId, p_user: userId });
  if (error) throw error;
}

/** supabase-js sets a generic FunctionsHttpError on a non-2xx edge response and leaves
 *  `data` null, so the real `{ error }` reason is only reachable via error.context (the raw
 *  Response). Fall back to the generic message when the body can't be read. */
async function edgeErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      const reason = (body as { error?: unknown })?.error;
      if (typeof reason === "string" && reason) return reason;
    } catch { /* body not JSON / already read — fall through */ }
  }
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Full account delete for a removed user, only when this was their last org (edge fn).
 *  Returns { retained: true } (no delete) when the user still belongs to another org. */
export async function purgeRemovedUser(
  client: SupabaseClient<Database>, orgId: string, userId: string,
): Promise<{ deleted: boolean; retained: boolean }> {
  const { data, error } = await client.functions.invoke("org-purge-removed-user", {
    body: { org_id: orgId, user_id: userId },
  });
  // A non-2xx edge response surfaces as `error`; read the JSON body so the caller sees the
  // real reason (not_removed / anonymize_failed / delete_failed), not "non-2xx status code".
  if (error) throw new Error(await edgeErrorMessage(error));
  const payload = data as { error?: string; deleted?: boolean; retained?: boolean };
  if (payload?.error) throw new Error(payload.error);
  return { deleted: !!payload?.deleted, retained: !!payload?.retained };
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
