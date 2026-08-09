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

  // Defense-in-depth: never mint an auth link to a caller-supplied origin that isn't
  // allowlisted. create-invitation / resend-invitation / provision-org pass app_origin
  // through with only a trailing-slash trim; a foreign origin would otherwise land in the
  // invite (and, new in this PR, the existing-user magic-link) redirect. Fall back to the
  // canonical app origin rather than reject, so a legitimate off-list origin still delivers.
  const origin = safeAppOrigin(args.appOrigin, deps) ?? appUrl(deps.env).replace(/\/+$/, "");

  let actionLink: string | undefined;
  if (!exists) {
    // NET-NEW: invite link creates the account, lands on set-password, then accept.
    const redirectTo = `${origin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
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
    const redirectTo = `${origin}/auth/callback?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink",
      email: args.email,
      options: { redirectTo },
    });
    if (error) throw error;
    actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
  }

  // Guard both branches the way send-login-link does: a generateLink that resolves without an
  // action_link would leave `actionLink` undefined, and org-invitation.tsx would silently fall
  // back to the bare token URL — re-introducing the exact dead-end this change fixes (an existing
  // user with no session lands on /login with no way in). Fail loudly instead (mirrors the throws).
  if (!actionLink) {
    console.error("deliverOrgInvitation: generateLink returned no action_link", { existingUser: exists });
    throw new Error("generateLink returned no action_link");
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
