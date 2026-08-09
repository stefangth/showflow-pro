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

/** True if an auth user already exists for `email` (paginated listUsers). */
export async function userExistsByEmail(deps: Deps, email: string): Promise<boolean> {
  const target = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data: list, error } = await deps.admin.auth.admin.listUsers({ page, perPage: 200 });
    // A swallowed error returns users:[] → an existing user would be misrouted through the
    // net-new path and get a duplicate account. Fail loudly instead.
    if (error) throw error;
    const users = (list?.users ?? []) as Array<{ email?: string }>;
    if (users.some((u) => u.email?.toLowerCase() === target)) return true;
    if (users.length < 200) return false;
  }
}

/**
 * Deliver ONE branded org-invitation email. For a net-new user we mint a Supabase
 * invite action link (this also creates the account; Supabase sends no email of its
 * own) that lands on /reset-password?redirect=/accept-invite?token=… so the user sets
 * a password and then accepts. For an existing user (re-invite / passwordless / expired)
 * we mint a magic link that logs them in and lands on accept via /auth/callback — they
 * never hit the reset flow, and can set a password later in-app on ProfilePage.
 */
export async function deliverOrgInvitation(deps: Deps, args: DeliverInviteArgs): Promise<void> {
  const acceptPath = `/accept-invite?token=${args.token}`;
  const exists = await userExistsByEmail(deps, args.email);

  let actionLink: string | undefined;
  if (!exists) {
    // NET-NEW: invite link creates the account, lands on set-password, then accept.
    const redirectTo = `${args.appOrigin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "invite",
      email: args.email,
      options: { redirectTo },
    });
    if (error) throw error;
    actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
  } else {
    // EXISTING (re-invite / passwordless / expired): magic link logs them in and lands
    // on accept via /auth/callback. They can set a password later in-app on ProfilePage.
    const redirectTo = `${args.appOrigin}/auth/callback?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink",
      email: args.email,
      options: { redirectTo },
    });
    if (error) throw error;
    actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
  }

  await deps.sendEmail({
    template_name: "org-invitation",
    recipient_email: args.email,
    org_id: args.orgId,
    templateData: {
      orgName: args.orgName,
      role: args.role,
      token: args.token,
      inviterEmail: args.inviterEmail,
      actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
