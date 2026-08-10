import type { Deps, InvokeResult } from "./deps.ts";
import { safeAppOrigin } from "./appOrigin.ts";
import { appUrl } from "./app-url.ts";

export interface DeliverInviteArgs {
  email: string;
  orgName?: string;
  /** Display label rendered in the role sentence, e.g. "Production Team" (roleLabel()). */
  role?: string;
  /** Raw role enum ('admin' | 'producer' | 'artist'), used by the template to select the
   *  right second-person role action line. See org-invitation.tsx's roleActionLine. */
  roleKey?: string;
  token: string;
  inviterEmail?: string;
  inviterName?: string;
  expiresOn?: string;
  /**
   * Which branch ensureInvitedUser took for this invitee: `true` for a net-new account
   * (the invite link creates it and lands on set-password before accept), `false` for an
   * existing account (a magic link signs them straight in, no password prompt). Drives
   * which of the two ctaHint variants the template renders, so the email never promises
   * a one-click sign-in to someone who is about to be asked for a password. Omitted only
   * for a hand-built invite that never called ensureInvitedUser; the template defaults to
   * the new-user copy in that case (the common case, and the safer of the two to be wrong
   * about: it undersells the one-click path rather than overselling it).
   */
  isNewUser?: boolean;
  appOrigin: string;
  idempotencyKey: string;
  orgId?: string;
}

/**
 * Human-readable expiry date and time for the invitation email's expiry line, e.g.
 * "24 August 2026, 09:00 Berlin time". Reads straight off the invitation row's
 * `expires_at` (the DB default, not a hardcoded duration) so the email can never claim a
 * window that doesn't match reality. Returns undefined when the row has no expiry (or an
 * unparsable value) so the template falls back to its generic expiryFallback copy instead
 * of rendering "Invalid Date". Fixed to Europe/Berlin (the booking engine's reference
 * timezone, see send-offer-digest) rather than UTC, so an expiry that lands right around
 * midnight doesn't render the calendar day before it does for everyone in or near that
 * timezone.
 *
 * The time is included on purpose, not just the date: `accept_invitation`'s
 * `expires_at > now()` check is exact to the second, so a date-only rendering ("24
 * August 2026") reads as valid all day when the row actually expires at 09:00 that
 * morning. Stating the hour keeps the email's claim never later than the DB's actual
 * cutoff. Day-before-month ("24 August 2026") plus a trailing "Berlin time" (rather than
 * "August 24, 2026, ... Berlin") keeps the sentence to a single comma instead of two, and
 * reads unambiguously to a recipient outside Germany.
 */
export function formatExpiresOn(expiresAt: string | null | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const datePart = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })
    .format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Berlin" })
    .format(date);
  return `${datePart}, ${timePart} Berlin time`;
}

/** Matches the org_invitations.expires_at column default (`now() + interval '14 days'`,
 *  see supabase/migrations/20260603120000_add_platform_tables_and_org_helpers.sql) set at
 *  insert time. The invitation row's `expires_at` is the single source of truth for every
 *  email that states an expiry (create, resend, provision-org all read it straight off the
 *  row via `formatExpiresOn` — none of them compute or persist a new value): this constant
 *  exists only so `org-invitation.expiryFallback`'s generic "14 days" copy, and the Settings
 *  preview's sample date, stay honest about the DB default without hardcoding the number
 *  twice. invitations.test.ts pins it to the migration SQL, the same guard pattern
 *  src/lib/capabilityDefaultsSql.test.ts uses for capability_default() vs. its TS twin: a
 *  future change to the column default without a matching edit here fails a test instead
 *  of silently shipping stale fallback copy. */
export const ORG_INVITATION_EXPIRY_DAYS = 14;

/**
 * Resolve a friendly display name for an invitation's inviter, for the org-invitation
 * email's "Invited by" line: their profiles.display_name when set, else `name` is left
 * undefined so the caller falls back to `email`. Returns `{}` when there is no inviter
 * to resolve (e.g. a hand-created invite). Shared by every caller of
 * sendOrgInvitationEmail so "who invited me" always reads the same way regardless of
 * which flow sent the email.
 *
 * `name` is intentionally NOT pre-filled with `email` here: the org-invitation template
 * already does `inviterName || inviterEmail` when it builds the "Invited by" line, so
 * doing the fallback here too would just make that template-side fallback unreachable.
 */
export async function resolveInviterName(
  deps: Deps,
  inviterId: string | null | undefined,
): Promise<{ name?: string; email?: string }> {
  if (!inviterId) return {};
  const [{ data: profile }, { data: userData }] = await Promise.all([
    deps.admin.from("profiles").select("display_name").eq("user_id", inviterId).maybeSingle(),
    deps.admin.auth.admin.getUserById(inviterId),
  ]);
  const email = userData?.user?.email ?? undefined;
  const displayName = profile?.display_name?.trim() || undefined;
  return { name: displayName, email };
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
): Promise<{ userId: string | null; actionLink?: string; isNewUser: boolean }> {
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
    return { userId: existingId as string, actionLink, isNewUser: false };
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
  return { userId: d?.user?.id ?? null, actionLink, isNewUser: true };
}

/**
 * Deliver ONE branded org-invitation email. Returns the raw send result (rather than a
 * bare `Promise<void>`) so a caller can gate a side effect on `emailWasSent(result)` from
 * `_shared/deps.ts` instead of assuming a call that didn't throw means the email went out
 * — `sendEmail` never throws, and a suppressed/skipped address comes back as HTTP 200
 * `{ success: false }`. `resend-invitation` gates BOTH its HTTP response and the
 * mark_invitation_resent stamp on it: for a resend the email IS the deliverable.
 * create-invitation and provision-org stay fire-and-forget: their row/org already exists
 * regardless of delivery, so they only log a send failure.
 */
export async function sendOrgInvitationEmail(
  deps: Deps,
  args: DeliverInviteArgs & { actionLink?: string },
): Promise<InvokeResult> {
  return await deps.sendEmail({
    template_name: "org-invitation",
    recipient_email: args.email,
    org_id: args.orgId,
    templateData: {
      orgName: args.orgName,
      role: args.role,
      roleKey: args.roleKey,
      token: args.token,
      inviterEmail: args.inviterEmail,
      inviterName: args.inviterName,
      expiresOn: args.expiresOn,
      isNewUser: args.isNewUser,
      actionLink: args.actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
