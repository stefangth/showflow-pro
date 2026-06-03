import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: AppRole;
  status: string; // 'pending' | 'accepted' | 'revoked'
  token: string;
  expires_at: string;
  created_at?: string;
}

/** Absolute accept-invite link for an invitation token (for copy-to-clipboard). */
export function acceptInviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/accept-invite?token=${token}`;
}

/**
 * Create an invitation (org admin only). Runs server-side in the create-invitation
 * edge function: inserts the org_invitations row + sends the invite email. Returns
 * the created invitation (incl. token, so the UI can also offer a copy-link).
 */
export async function createInvitation(
  client: SupabaseClient<Database>,
  args: { orgId: string; email: string; role: AppRole },
): Promise<Invitation> {
  const { data, error } = await client.functions.invoke("create-invitation", {
    body: { org_id: args.orgId, email: args.email, role: args.role },
  });
  if (error) throw error;
  const payload = data as { error?: string; invitation?: Invitation };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.invitation) throw new Error("Invitation was not created");
  return payload.invitation;
}

/** All invitations for an org, newest first. */
export async function fetchOrgInvitations(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<Invitation[]> {
  const { data, error } = await client
    .from("org_invitations")
    .select("id, org_id, email, role, status, token, expires_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Invitation[];
}

/** Revoke a pending invitation. */
export async function revokeInvitation(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client
    .from("org_invitations")
    .update({ status: "revoked" })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Accept an invitation by token (authenticated user). Server-side SECURITY DEFINER
 * RPC validates the token/expiry/email and writes the org_membership. Returns the org_id.
 */
export async function acceptInvitation(
  client: SupabaseClient<Database>,
  token: string,
): Promise<string> {
  const { data, error } = await client.rpc("accept_invitation", { p_token: token });
  if (error) throw error;
  return data as string;
}
