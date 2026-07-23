import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";

export { createInvitation } from "@/data/invitations";

export interface PlatformUserMembership {
  org_id: string;
  org_name: string;
  roles: AppRole[];
  artist: { id: string; name: string } | null;
}
export interface PlatformUser {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  suspended: boolean;
  memberships: PlatformUserMembership[];
}

export interface PlatformUsersResult {
  users: PlatformUser[];
  /** true when the underlying auth.admin.listUsers page hit the 1000-row cap
   *  — the roster is not exhaustive and callers must surface this, not drop it. */
  truncated: boolean;
}

/** All platform users across every org, via the super-admin-only platform-list-users edge function. */
export async function fetchPlatformUsers(client: SupabaseClient<Database>): Promise<PlatformUsersResult> {
  const { data, error } = await client.functions.invoke("platform-list-users", { body: {} });
  if (error) throw error;
  const payload = data as { error?: string; users?: PlatformUser[]; truncated?: boolean };
  if (payload?.error) throw new Error(payload.error);
  return { users: payload.users ?? [], truncated: !!payload.truncated };
}

/** Add or remove a role for a user in an org (super-admin-only RPC). */
export async function setMembership(
  client: SupabaseClient<Database>,
  args: { orgId: string; userId: string; role: AppRole; action: "add" | "remove" },
): Promise<void> {
  const { error } = await client.rpc("platform_set_membership", {
    p_org: args.orgId, p_user: args.userId, p_role: args.role, p_action: args.action,
  });
  if (error) throw error;
}

/** Remove a user entirely from an org (all roles; super-admin-only RPC). */
export async function removeMembership(
  client: SupabaseClient<Database>,
  args: { orgId: string; userId: string },
): Promise<void> {
  const { error } = await client.rpc("platform_remove_membership", { p_org: args.orgId, p_user: args.userId });
  if (error) throw error;
}

/** Link (or unlink, when artistId is null) a user to a catalog artist within an org (super-admin-only RPC). */
export async function linkArtist(
  client: SupabaseClient<Database>,
  args: { orgId: string; userId: string; artistId: string | null },
): Promise<void> {
  const { error } = await client.rpc("platform_link_artist", {
    p_org: args.orgId, p_user: args.userId, p_artist_id: args.artistId,
  });
  if (error) throw error;
}

export type ManageUserBody =
  | { action: "change_email"; target_user_id: string; new_email: string }
  | { action: "send_password_reset" | "suspend" | "unsuspend" | "delete"; target_user_id: string };

/** Super-admin user-management actions (email change, password reset, suspend/unsuspend, delete). */
export async function manageUser(client: SupabaseClient<Database>, body: ManageUserBody): Promise<void> {
  const { data, error } = await client.functions.invoke("platform-manage-user", { body });
  if (error) throw error;
  const payload = data as { error?: string };
  if (payload?.error) throw new Error(payload.error);
}
