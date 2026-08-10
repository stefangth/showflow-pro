import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/config/app.config";
import { readEdgeError } from "@/lib/edgeErrors";

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: AppRole;
  status: string; // 'pending' | 'accepted' | 'revoked'
  token: string;
  expires_at: string;
  created_at?: string;
  /** Set when the invite was created from a specific catalog artist (deterministic link). */
  artist_id?: string | null;
  /** When the invite was last resent + how many times, surfaced so multiple admins can coordinate. */
  last_resent_at?: string | null;
  resent_count?: number;
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
  args: { orgId: string; email: string; role: AppRole; artistId?: string },
): Promise<Invitation> {
  const body: Record<string, unknown> = {
    org_id: args.orgId, email: args.email, role: args.role, app_origin: window.location.origin,
  };
  if (args.artistId) body.artist_id = args.artistId;
  const { data, error } = await client.functions.invoke("create-invitation", { body });
  if (error) throw error;
  const payload = data as { error?: string; invitation?: Invitation };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.invitation) throw new Error("Invitation was not created");
  return payload.invitation;
}

/**
 * Invite an existing catalog artist to an app login. Always role 'artist', and the
 * invitation is stamped with the artist_id so accept_invitation links that exact row
 * (even if the login email ends up differing from the booking email).
 */
export async function inviteArtistToApp(
  client: SupabaseClient<Database>,
  args: { orgId: string; artistId: string; email: string },
): Promise<Invitation> {
  return createInvitation(client, { orgId: args.orgId, email: args.email, role: "artist", artistId: args.artistId });
}

/** All invitations for an org, newest first. */
export async function fetchOrgInvitations(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<Invitation[]> {
  const { data, error } = await client
    .from("org_invitations")
    .select("id, org_id, email, role, status, token, expires_at, created_at, artist_id, last_resent_at, resent_count")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Invitation[];
}

export interface PendingArtistInvitation {
  id: string;
  artistId: string | null;
  email: string;
}

interface PendingArtistInvitationRow {
  id: string;
  artist_id: string | null;
  email: string;
}

/** Pending artist-role invitations for an org (drives the Artists-page revoke/resend controls). */
export async function fetchPendingArtistInvitations(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<PendingArtistInvitation[]> {
  const { data, error } = await client
    .from("org_invitations")
    .select("id, artist_id, email")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .eq("role", "artist");
  if (error) throw error;
  return ((data ?? []) as unknown as PendingArtistInvitationRow[]).map((r) => ({
    id: r.id,
    artistId: r.artist_id,
    email: r.email,
  }));
}

/** Revoke a pending invitation and remove the membership it created (admin/super-admin RPC). */
export async function revokeInvitation(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.rpc("revoke_invitation", { p_id: id });
  if (error) throw error;
}

/**
 * Reconcile any pending invitations for the signed-in user's email (membership + artist
 * profile + status), for any auth path. Best-effort: callers ignore the count. Returns the
 * number of invitations claimed.
 */
export async function claimMyInvitations(client: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await client.rpc("claim_my_invitations");
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/**
 * Accept an invitation by token (authenticated user). Server-side SECURITY DEFINER
 * RPC validates the token/expiry/email and writes the org_membership. Returns the
 * org_id plus `artistLinked` — false only when an artist_id-stamped invite couldn't
 * auto-link the talent profile (caller already owns an artist in the org).
 */
export async function acceptInvitation(
  client: SupabaseClient<Database>,
  token: string,
): Promise<{ orgId: string; artistLinked: boolean }> {
  const { data, error } = await client.rpc("accept_invitation", { p_token: token });
  if (error) throw error;
  const r = (data ?? {}) as { org_id?: string; artist_linked?: boolean };
  return { orgId: r.org_id ?? "", artistLinked: r.artist_linked !== false };
}

/** Re-send a pending org invitation (org admin or super-admin). The edge function's 422
 *  (suppressed address) and 502 (delivery failure) bodies carry sentences written for the
 *  admin's toast, and supabase-js hides them behind an opaque invoke error, so read the
 *  body back out (see src/lib/edgeErrors.ts) instead of rethrowing the husk. */
export async function resendInvitation(
  client: SupabaseClient<Database>,
  invitationId: string,
): Promise<void> {
  const { error } = await client.functions.invoke("resend-invitation", {
    body: { invitation_id: invitationId, app_origin: window.location.origin },
  });
  if (error) throw new Error(await readEdgeError(error));
}
