import type { Deps, InvokeResult } from "./deps.ts";
import { safeAppOrigin } from "./appOrigin.ts";
import { appUrl } from "./app-url.ts";
import { EMAIL_COPY_DEFAULTS } from "./transactional-email-templates/_shell/emailCopy.ts";

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
  /** The value that fills the email's {{expiresOn}} token (org-invitation.expiryLine).
   *  Always the GUARANTEED-valid rendering from formatExpiryThrough, never the exact
   *  calendar day of the row's expires_at (formatExpiresOn): the email's claim has to
   *  hold for the reader's whole day, see formatExpiryThrough's doc comment. */
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
  /**
   * The inviting org's booking_flow.artist_acceptance (_shared/bookingFlow.ts), consulted
   * by the template ONLY when roleKey === 'artist' to choose between the offers-aware
   * role line (roleIntroArtistOffers) and the flattened, flow-neutral one (roleIntroArtist)
   * that stays true for a direct-book org. Undefined defaults to true in the template,
   * matching BOOKING_FLOW_DEFAULTS.artist_acceptance and every other consumer of this
   * setting: most orgs never turn it off, so the common case is the one that actually
   * tells the artist about the offers they will receive. Irrelevant, and safe to omit,
   * for every non-artist invite.
   */
  artistAcceptance?: boolean;
  appOrigin: string;
  idempotencyKey: string;
  orgId?: string;
}

/**
 * Human-readable expiry date rendering the EXACT calendar day of `expiresAt`, e.g.
 * "August 24, 2026" for a row whose `expires_at` falls anywhere on August 24 (UTC).
 * Returns undefined when there is no expiry (or an unparsable value) to render.
 *
 * Date-only, no time-of-day and no timezone name: an org-invitation goes to a stranger
 * who has no reason to know or care what timezone the booking engine runs on, so a
 * trailing "Berlin time" would couple a recipient-facing, tenant-agnostic email to one
 * specific tenant's operating region (unlike the digest emails, which are genuinely
 * Berlin-scheduled and say so). Formatted in UTC so the calendar day is deterministic
 * regardless of the invitee's own location, rather than reading the server's local zone.
 *
 * This is the exact day, not a guaranteed-valid one: `org_invitations.expires_at` is a
 * TIMESTAMP that keeps the row's creation time-of-day (`now() + interval '14 days'`), and
 * `accept_invitation` gates on `expires_at > now()` exactly to the second, so the calendar
 * day this function names is only reliable for PART of itself, up to that time-of-day, not
 * the whole day. Do not use this for a forward-looking claim that has to hold for a
 * reader's entire day (the org-invitation email's expiryLine): use formatExpiryThrough
 * (below) for that. This function is for statements where the exact day is what's wanted,
 * e.g. resend-invitation's past-tense "this invitation expired on {date}" error, where a
 * conservative day would understate how long ago it actually expired.
 */
export function formatExpiresOn(expiresAt: string | null | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(date);
}

/**
 * The GUARANTEED-valid rendering for the org-invitation email's forward-looking expiry
 * line ("This invitation is open through {{expiresOn}}."): the last FULL calendar day the
 * invitation is certain to still be valid, one day earlier than formatExpiresOn's exact
 * day.
 *
 * Why a day earlier is necessary: `expires_at` keeps the row's creation time-of-day (see
 * formatExpiresOn's doc comment), and `accept_invitation` checks `expires_at > now()` to
 * the second. Naming the EXACT calendar day of `expires_at` would be false for a reader
 * who opens the email on that exact day, after the cutoff's time-of-day: they would read
 * "open through August 24" and then hit a dead link that same day.
 *
 * Stepping back 24 hours before formatting always lands on a day that is fully valid.
 * Call the real cutoff C and let D be the UTC calendar day of (C minus 24h): D started at
 * or before (C minus 24h), i.e. at least 24 hours before C. D's own last instant, 23
 * hours 59 minutes 59.999 seconds after D started, is therefore still under 24 hours
 * after D started, and so strictly before C. That holds no matter what time-of-day C
 * itself falls at, so every hour of the rendered day is safely before the real cutoff.
 * invitations.test.ts pins this with a mid-day boundary case.
 *
 * Only used for the email's own forward-looking claim: formatExpiresOn's exact rendering
 * stays correct, and is still used, for past-tense statements (see its doc comment).
 */
export function formatExpiryThrough(expiresAt: string | null | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatExpiresOn(new Date(date.getTime() - 24 * 60 * 60 * 1000).toISOString());
}

/** Matches the org_invitations.expires_at column default (`now() + interval '14 days'`,
 *  see supabase/migrations/20260603120000_add_platform_tables_and_org_helpers.sql) set at
 *  insert time. The invitation row's `expires_at` is the single source of truth for every
 *  email that states an expiry (create, resend, provision-org all read it straight off the
 *  row via `formatExpiryThrough` — none of them compute or persist a new value): this
 *  constant exists only so `org-invitation.expiryFallback`'s generic "14 days" copy, and
 *  the Settings preview's sample date, stay honest about the DB default without
 *  hardcoding the number twice. invitations.test.ts pins it to the migration SQL, the
 *  same guard pattern src/lib/capabilityDefaultsSql.test.ts uses for capability_default()
 *  vs. its TS twin: a future change to the column default without a matching edit here
 *  fails a test instead of silently shipping stale fallback copy. */
export const ORG_INVITATION_EXPIRY_DAYS = 14;

/**
 * Generic "who invited you" fallback for an invitation with no personal inviter to name:
 * used ONLY by provision-org's first-admin invite (see the doc comment on
 * org-invitation.inviterFallback in emailCopy.ts for why that caller never forwards the
 * platform operator's own name or email). Sourced from the editable copy registry rather
 * than a hardcoded literal, so it is covered by the same em/en-dash guard, and is visible
 * in Settings > Email templates, as every other line in this email. */
export const SYSTEM_INVITER_NAME = EMAIL_COPY_DEFAULTS["org-invitation.inviterFallback"];

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
      artistAcceptance: args.artistAcceptance,
      actionLink: args.actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
