import type { Deps } from "./deps.ts";

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
 * Resolve the auth user for an invite, creating a net-new account when needed.
 * Existing users: id via get_user_id_by_email (no email sent here, no link minted).
 * Net-new users: mint a Supabase invite action link (this also creates the account;
 * Supabase sends no email of its own) that lands on
 * /reset-password?redirect=/accept-invite?token=… and return both the new id and the
 * action_link.
 */
export async function ensureInvitedUser(
  deps: Deps,
  args: { email: string; appOrigin: string; token: string },
): Promise<{ userId: string | null; actionLink?: string }> {
  const email = args.email.toLowerCase();
  const { data: existingId } = await deps.admin.rpc("get_user_id_by_email", { p_email: email });
  if (existingId) return { userId: existingId as string };

  const acceptPath = `/accept-invite?token=${args.token}`;
  const redirectTo = `${args.appOrigin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
  const { data, error } = await deps.admin.auth.admin.generateLink({
    type: "invite",
    email: args.email,
    options: { redirectTo },
  });
  if (error) throw error;
  const d = data as { properties?: { action_link?: string }; user?: { id?: string } } | null;
  return { userId: d?.user?.id ?? null, actionLink: d?.properties?.action_link };
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
