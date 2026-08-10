import type { Deps } from "./deps.ts";
import { safeAppOrigin } from "./appOrigin.ts";
import { appUrl } from "./app-url.ts";

export interface DeliverInviteArgs {
  email: string;
  orgName?: string;
  role?: string;
  token: string;
  inviterEmail?: string;
  appOrigin: string;
  idempotencyKey: string;
  orgId?: string;
}

/**
 * Resolve the auth user for an invite and mint the right action link, so the invite email
 * always carries a working way in and the caller can create the membership at invite time
 * (with the returned userId; claim_my_invitations then self-heals on first sign-in):
 *  - EXISTING user (re-invite / passwordless / expired): a magic link that logs them in and
 *    lands on accept via /auth/callback — they never hit the reset flow and can set a password
 *    later in-app on ProfilePage. Returns their id + the link.
 *  - NET-NEW user: a Supabase invite link that also creates the account and lands on
 *    /reset-password?redirect=/accept-invite so they set a password, then accept. Returns the
 *    new id + the link.
 *
 * appOrigin is passed through safeAppOrigin so a foreign caller-supplied origin can never be
 * minted into the redirect; we fall back to the canonical app origin rather than reject. A
 * generateLink that resolves without an action_link throws (a bare-token email would dead-end
 * an account-less / session-less user), mirroring the loud failure send-login-link uses.
 */
export async function ensureInvitedUser(
  deps: Deps,
  args: { email: string; appOrigin: string; token: string },
): Promise<{ userId: string | null; actionLink?: string }> {
  const email = args.email.toLowerCase();
  const origin = safeAppOrigin(args.appOrigin, deps) ?? appUrl(deps.env).replace(/\/+$/, "");
  const acceptPath = `/accept-invite?token=${args.token}`;
  const { data: existingId } = await deps.admin.rpc("get_user_id_by_email", { p_email: email });

  if (existingId) {
    // EXISTING: magic link logs them in and lands on accept via /auth/callback.
    const redirectTo = `${origin}/auth/callback?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink",
      email: args.email,
      options: { redirectTo },
    });
    if (error) throw error;
    const actionLink = (data as { properties?: { action_link?: string } } | null)?.properties?.action_link;
    if (!actionLink) {
      console.error("ensureInvitedUser: generateLink returned no action_link", { existingUser: true });
      throw new Error("generateLink returned no action_link");
    }
    return { userId: existingId as string, actionLink };
  }

  // NET-NEW: invite link creates the account, lands on set-password, then accept.
  const redirectTo = `${origin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
  const { data, error } = await deps.admin.auth.admin.generateLink({
    type: "invite",
    email: args.email,
    options: { redirectTo },
  });
  if (error) throw error;
  const d = data as { properties?: { action_link?: string }; user?: { id?: string } } | null;
  const actionLink = d?.properties?.action_link;
  if (!actionLink) {
    console.error("ensureInvitedUser: generateLink returned no action_link", { existingUser: false });
    throw new Error("generateLink returned no action_link");
  }
  return { userId: d?.user?.id ?? null, actionLink };
}

/** Deliver ONE branded org-invitation email (best-effort at the call site). */
export async function sendOrgInvitationEmail(
  deps: Deps,
  args: DeliverInviteArgs & { actionLink?: string },
): Promise<void> {
  await deps.sendEmail({
    template_name: "org-invitation",
    recipient_email: args.email,
    org_id: args.orgId,
    templateData: {
      orgName: args.orgName,
      role: args.role,
      token: args.token,
      inviterEmail: args.inviterEmail,
      actionLink: args.actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
