import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Deps, InvokeResult } from "./deps.ts";
import { safeAppOrigin } from "./appOrigin.ts";
import { appUrl } from "./app-url.ts";
import { resolveBookingFlow } from "./bookingFlow.ts";
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
  /** The value that fills the email's {{expiresOn}} token (org-invitation.expiryLine):
   *  the exact calendar day of the row's expires_at via formatExpiresOn, no arithmetic.
   *  The line's second sentence ("ask for it to be resent") owns every edge a date
   *  cannot: the short-lived action link, and the window's partly-elapsed final day. */
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
   * Whether this artist invitee can actually expect emailed booking offers, consulted by
   * the template ONLY when roleKey === 'artist' to choose between the offers-aware role
   * line (roleIntroArtistOffers) and the flattened, flow-neutral one (roleIntroArtist).
   * Resolve this with resolveArtistOffersExpected (below), never by reading
   * resolveBookingFlow(...).artist_acceptance alone: that alone cannot tell an
   * unentitled or paused org apart from one that genuinely sends offers, since
   * resolveBookingFlow fails OPEN to BOOKING_FLOW_DEFAULTS (artist_acceptance: true) in
   * both of those cases. Undefined and false render IDENTICALLY (the flow-neutral
   * line): unlike most flags in this file, the safe default here is NOT "assume the
   * common case", because the common case is a promise ("you will get emailed offers")
   * that must be true, not just usually true. Irrelevant, and safe to omit, for every
   * non-artist invite.
   */
  offersExpected?: boolean;
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
 * the whole day. The expiryLine that renders it therefore pairs the date with a remedy
 * sentence ("If the sign-in button stops working, ask for it to be resent.") instead of
 * hardening the date itself: an earlier revision shipped a 48-hour "guaranteed day"
 * step-back here, and the arithmetic kept minting new false claims on the resend path
 * (a stepped-back day in the past, then a fallback promising weeks near expiry). The
 * exact day plus a remedy is the strongest claim that stays true in every state.
 */
export function formatExpiresOn(expiresAt: string | null | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(date);
}

/** Matches the org_invitations.expires_at column default (`now() + interval '14 days'`,
 *  see supabase/migrations/20260603120000_add_platform_tables_and_org_helpers.sql) set at
 *  insert time. The invitation row's `expires_at` is the single source of truth for every
 *  email that states an expiry (create, resend, provision-org all read it straight off the
 *  row via `formatExpiresOn` — none of them compute or persist a new value): this
 *  constant has exactly ONE consumer left, org-invitation.tsx's `previewData.expiresOn`
 *  (the Settings > Email templates preview's sample date), which needs SOME plausible
 *  `expires_at` for a row that does not really exist. It is NOT read by
 *  `org-invitation.expiryFallback`: that copy deliberately states no day count at all
 *  (see the doc comment on that key in emailCopy.ts, and the test right below this one
 *  pinning that no stray digit has crept back into it).
 *  invitations.test.ts still pins this constant to the migration SQL, the same guard
 *  pattern src/lib/capabilityDefaultsSql.test.ts uses for capability_default() vs. its TS
 *  twin: a future change to the column default without a matching edit here would
 *  otherwise leave the PREVIEW silently understating the real window, even though no
 *  actual send is affected. */
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
 *
 * Reads `profiles` FIRST and only falls through to `auth.admin.getUserById` (an Admin
 * API call, not a plain table read) when no display_name was found: a resolved name
 * already wins over the email in every caller (org-invitation.tsx's `inviterName ||
 * inviterEmail`, this function's own doc comment above), so fetching the email too in
 * that case would be an Admin API round trip whose result no template ever renders, and
 * would put a colleague's raw email address into templateData for no reason. Only the
 * no-display_name path still needs the email at all, since that IS the value the caller
 * falls back to.
 */
export async function resolveInviterName(
  deps: Deps,
  inviterId: string | null | undefined,
): Promise<{ name?: string; email?: string }> {
  if (!inviterId) return {};
  const { data: profile } = await deps.admin
    .from("profiles").select("display_name").eq("user_id", inviterId).maybeSingle();
  const displayName = (profile as { display_name?: string | null } | null)?.display_name?.trim() || undefined;
  if (displayName) return { name: displayName };
  const { data: userData } = await deps.admin.auth.admin.getUserById(inviterId);
  return { email: userData?.user?.email ?? undefined };
}

/**
 * Whether an artist invited to `orgId` can actually expect emailed booking offers, for
 * org-invitation's role line (see the `offersExpected` doc comment on DeliverInviteArgs
 * above, and roleIntroArtistOffers vs. the flow-neutral roleIntroArtist in
 * org-invitation.tsx). Checks the SAME signals open-offer-tier and send-offer-digest
 * themselves gate a real offer send on, not just one of them:
 *  - `booking_flow` is entitled for the org (the same `is_feature_enabled` RPC
 *    checkFeature itself wraps, called directly here rather than through checkFeature;
 *    see the fail-direction note below for why). This has to be checked SEPARATELY, not
 *    read off resolveBookingFlow's return: resolveBookingFlow fails
 *    OPEN to BOOKING_FLOW_DEFAULTS (active: true, artist_acceptance: true) whenever the
 *    entitlement is off, so an unentitled org's defaults would otherwise read as
 *    "offers coming" even though the module never runs for that org at all.
 *  - `flow.active`, the flow's own master switch. Every freshly provisioned org with
 *    booking enabled starts with `booking_flow = { active: false }` (see
 *    provision-org's offFlow seed): resolveBookingFlow happily returns that stored row
 *    with `artist_acceptance` defaulted true (unset in the override), which would
 *    otherwise read as "offers coming" for an org that has not even turned booking on.
 *  - `flow.artist_acceptance`, the org's own direct-book toggle.
 *
 * Deliberately fails CLOSED (false) on any unexpected error, the opposite direction from
 * checkFeature's own booking_flow fail-open and from resolveBookingFlow's
 * fallback-to-defaults: those protect LIVE production traffic (six request/cron-driven
 * consumers that must keep resolving SOME shape rather than throw); this only decides
 * one sentence in an email nobody has acted on yet, where a wrong "no offers" merely
 * shows the flow-neutral line (still true either way) while a wrong "offers coming" is a
 * promise this stranger may never see kept.
 *
 * This is why the entitlement check below does NOT call checkFeature: checkFeature's
 * `booking_flow` fail-open returns `true` (not a throw) on an `is_feature_enabled` RPC
 * error — supabase-js reports a query/RPC fault as `{ data: null, error }`, it does not
 * reject the promise, so a try/catch wrapped around checkFeature can never observe that
 * fault at all. Calling the same RPC directly here and reading its `error` ourselves is
 * what actually gives this function its own, opposite fail direction: an
 * `is_feature_enabled` fault reads as "not entitled" (false) for this one sentence,
 * regardless of what checkFeature's other, production-facing callers do with the same
 * fault. See "false when the entitlement RPC itself errors" in invitations.test.ts for
 * the regression this closes.
 */
export async function resolveArtistOffersExpected(
  admin: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  try {
    const [entitlementResult, flow] = await Promise.all([
      admin.rpc("is_feature_enabled", { _org: orgId, _feature: "booking_flow" }),
      resolveBookingFlow(admin, orgId),
    ]);
    if (entitlementResult.error) return false;
    const entitled = entitlementResult.data === true;
    return entitled && flow.active && flow.artist_acceptance;
  } catch {
    return false;
  }
}

/** Coarse time bucket folded into resend-invitation's idempotency key, alongside
 *  resent_count (see resendIdempotencyKey below). */
export const RESEND_IDEMPOTENCY_BUCKET_MS = 10 * 60 * 1000;

/**
 * The idempotency_key resend-invitation passes to send-transactional-email (which
 * forwards it to Resend as the `Idempotency-Key` header: Resend treats a repeated key as
 * "the same logical send" for 24 hours and replies 200 for the ORIGINAL message on any
 * repeat within that window, without re-delivering).
 *
 * Folds in two signals, not just resent_count:
 *  - `resentCount` is the primary signal that distinguishes a genuinely new resend from
 *    an in-flight duplicate (two requests racing before either one's mark_invitation_resent
 *    stamp lands both read the SAME resentCount and must mint the same key, so a
 *    double-click or network retry dedupes at Resend instead of sending the invitee two
 *    emails).
 *  - `now`, bucketed to RESEND_IDEMPOTENCY_BUCKET_MS, bounds how long a STALE resentCount
 *    can keep colliding. mark_invitation_resent is deliberately best-effort (see
 *    resend-invitation's stamp comment): if that write silently fails after a real send
 *    already succeeded, the next resend request re-reads the SAME resentCount and would
 *    otherwise mint the identical key for the rest of Resend's 24-hour dedup window,
 *    silently swallowing a genuine later resend. Once real time crosses a bucket
 *    boundary the key changes regardless of whether resentCount ever advanced, so a
 *    resend requested even a few minutes later (not a rapid double-click) still gets
 *    through. The bucket is short enough to keep the in-flight-duplicate guarantee above
 *    (two requests racing within the same bucket still dedupe) while bounding the
 *    stale-stamp exposure window to minutes instead of a full day.
 *
 *    Caveat: the in-flight-duplicate guarantee is bucket-scoped, not unconditional. Two
 *    requests that straddle a bucket boundary (one at T-1ms, one at T+1ms) mint DIFFERENT
 *    keys and both deliver, so an unlucky double-click right at the edge can still produce
 *    two identical emails rather than one deduped send. Low-stakes if it happens (the
 *    invitee gets the same invitation twice, never a wrong one), and rare (the boundary is
 *    a specific 1ms-wide instant every 10 minutes, not a wide window), which is why a
 *    second overlapping bucket was judged not worth the extra complexity here.
 */
export function resendIdempotencyKey(inviteId: string, resentCount: number, now: Date): string {
  const bucket = Math.floor(now.getTime() / RESEND_IDEMPOTENCY_BUCKET_MS);
  return `org-invitation-resend-${inviteId}-${resentCount}-${bucket}`;
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
      offersExpected: args.offersExpected,
      actionLink: args.actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
