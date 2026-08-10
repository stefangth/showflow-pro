/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { APP_URL } from "../app-url.ts";
import { formatExpiresOn, ORG_INVITATION_EXPIRY_DAYS } from "../invitations.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { applyEmailTokens, EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  orgName?: string;
  role?: string;
  /** Raw role enum ('admin' | 'producer' | 'artist'), used only to select which
   *  second-person roleIntro action line to render (see roleActionLine below). Kept
   *  separate from `role` (the display label used in the sentence itself) because the
   *  label alone is not a safe switch key: ROLE_LABELS is free text an org could in
   *  theory customize, but roleKey always comes straight off the DB enum. */
  roleKey?: string;
  inviterEmail?: string;
  inviterName?: string;
  expiresOn?: string;
  /** See DeliverInviteArgs.isNewUser in _shared/invitations.ts. Undefined defaults to the
   *  new-user copy (the common case: most invites are a first invite). */
  isNewUser?: boolean;
  /** See DeliverInviteArgs.offersExpected in _shared/invitations.ts. Only consulted when
   *  roleKey === 'artist'; must be EXPLICITLY true to render the offers-aware copy.
   *  Undefined (and false) render the flow-neutral line, since that line stays true
   *  whether or not offers are really coming and the offers-aware line is a promise
   *  that must be proven, not assumed. */
  offersExpected?: boolean;
  token?: string;
  actionLink?: string;
  _emailCopy?: EmailCopy;
  _emailTheme?: EmailTheme;
  _emailFamily?: EmailFamily;
  _highlightRole?: EmailRoleKey;
}

const OrgInvitationEmail = ({
  orgName,
  role,
  roleKey,
  inviterEmail,
  inviterName,
  expiresOn,
  isNewUser,
  offersExpected,
  token,
  actionLink,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy,
  _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet",
  _highlightRole,
}: Props) => {
  const copy = _emailCopy;
  const theme = _emailTheme;
  const org = orgName || copy["org-invitation.orgFallback"];
  // Both the CTA and the paste-line fallback use the one-click action link, which is always
  // minted now (invite link for net-new, magic link for existing) and works in both cases.
  // A net-new invitee needs this link (not the bare token URL) because the token accept URL
  // has no session/account for them and would dead-end at /login. It falls back to the token
  // accept URL only if no action link was produced.
  const acceptUrl = actionLink || (token ? `${APP_URL}/accept-invite?token=${token}` : APP_URL);
  // The friendly name wins over the raw email for the "Invited by" line; falls back to the
  // email when no profiles.display_name was resolvable, and renders no line at all when the
  // caller has neither (a hand-created invite with no known inviter).
  const inviter = inviterName || inviterEmail || "";
  const values = {
    orgName: org,
    role: role ?? "",
    inviterEmail: inviterEmail ?? "",
    inviter,
    expiresOn: expiresOn ?? "",
  };
  // The role paragraph is two sentences: a role-neutral opener built from the {{role}}
  // label (org-invitation.roleIntro), then a second-person action line that is genuinely
  // per-role copy, not the third-person ROLE_DESCRIPTIONS caption used elsewhere (see the
  // doc comment on ROLE_DESCRIPTIONS in src/config/app.config.ts for why those two can't
  // share one string). Selected by roleKey (the raw enum), not by the display label.
  // The artist line branches on offersExpected (see DeliverInviteArgs.offersExpected in
  // _shared/invitations.ts, resolved by resolveArtistOffersExpected): the offers-aware
  // line ONLY when explicitly true (the caller has confirmed booking_flow is entitled,
  // active, and set to accept offers for this org), the flattened flow-neutral line for
  // everything else, including undefined. This is deliberately the opposite default
  // direction from most flags here: undefined must NOT fall through to the common-case
  // copy, because the common-case copy is a promise ("you will get emailed offers") that
  // has to be proven true for this specific org, not assumed true because most orgs
  // never turn it off.
  const roleActionLine = roleKey === "admin"
    ? copy["org-invitation.roleIntroAdmin"]
    : roleKey === "producer"
      ? copy["org-invitation.roleIntroProducer"]
      : roleKey === "artist"
        ? (offersExpected === true ? copy["org-invitation.roleIntroArtistOffers"] : copy["org-invitation.roleIntroArtist"])
        : "";
  // Only state the role when BOTH the label and a matching action line resolved: a role
  // name with no recognized roleKey would render a dangling "Your role is X." with
  // nothing after it.
  const showRoleIntro = Boolean(role && roleActionLine);
  const roleIntroText = `${applyEmailTokens(copy["org-invitation.roleIntro"], values)} ${roleActionLine}`;
  // Every invite states SOME expiry so it never reads as open-ended: the real date from the
  // invitation row when known, else the generic fallback statement. The line is about the
  // invitation itself staying valid, not about the button working: the CTA's own TTL (a
  // short-lived Supabase action link) is unrelated to and usually shorter than this window,
  // and linkRecovery (in postCta, below) already tells the reader what to do if the button
  // itself stops working.
  const expiryText = expiresOn
    ? applyEmailTokens(copy["org-invitation.expiryLine"], values)
    : copy["org-invitation.expiryFallback"];
  // A net-new invitee has no password yet (the button walks them through setting one); a
  // returning invitee signs straight in via a magic link and never sees a password prompt.
  // Only `isNewUser === false` (explicitly resolved as an existing account) picks the
  // returning-user copy; undefined defaults to the new-user line, which is the common case.
  //
  // Both of those variants promise something specific about what clicking the button does
  // ("signs you in directly", "asks you to choose a password"), and that promise is only
  // TRUE when `acceptUrl` is the minted action link. The one caller that can send this
  // email with no actionLink (create-invitation's catch branch, when ensureInvitedUser
  // throws AFTER the invitee's existing account was already resolved) falls back to the
  // bare token URL, and /accept-invite bounces a session-less visitor to /login: neither
  // promise would be true there, so that case gets its own, honest copy instead.
  const ctaHint = !actionLink
    ? copy["org-invitation.ctaHintFallback"]
    : isNewUser === false
      ? copy["org-invitation.ctaHintExistingUser"]
      : copy["org-invitation.ctaHintNewUser"];
  const pasteLink = (
    <>
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 8px" }}>{copy["org-invitation.pasteLink"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0 0 8px" }}>{acceptUrl}</Text>
      {/* The recovery clause used to trail ctaHintNewUser/ctaHintExistingUser, right
          before the button; it lives here now, after the paste-link fallback, so it
          reads as the last word on "getting in" (covering both the button AND the
          pasted link) instead of a hedge planted right before the reader's first
          attempt at the button. */}
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0" }}>{copy["org-invitation.linkRecovery"]}</Text>
    </>
  );

  return (
    <EmailShell family={_emailFamily} theme={theme} previewText={applyEmailTokens(copy["org-invitation.previewText"], values)} heading={applyEmailTokens(copy["org-invitation.heading"], values)} footer={copy["org-invitation.footer"]} cta={{ href: acceptUrl, label: copy["org-invitation.ctaLabel"] }} postCta={pasteLink} highlightRole={_highlightRole}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["org-invitation.greeting"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{applyEmailTokens(copy["org-invitation.productIntro"], values)}</Text>
      {showRoleIntro && <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{roleIntroText}</Text>}
      {/* Rendered with the same "body" role as the paragraphs above it (not "footer"), so the
          expiry statement reads with the same visual weight as the rest of the explanation
          instead of fading into fine print right below it. */}
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{expiryText}</Text>
      {inviter && <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 16px" }}>{applyEmailTokens(copy["org-invitation.invitedBy"], values)}</Text>}
      {/* Last, right above the button EmailShell renders next: the reassurance about what
          clicking it does belongs immediately before the thing it describes. The paste-link
          fallback moves to EmailShell's postCta slot (below the button) instead of sitting
          here: it is a fallback FOR the button, so it reads better once the button has
          already been seen, not as a wall of URL text the reader has to skip past first. */}
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0" }}>{ctaHint}</Text>
    </EmailShell>
  );
};

export const template = {
  component: OrgInvitationEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) => applyEmailTokens(EMAIL_COPY_DEFAULTS["org-invitation.subject"], { orgName: String(data.orgName || "an organization") }),
  displayName: "Organization invitation",
  previewData: {
    orgName: "Cirque Lumière",
    role: "Production Team",
    roleKey: "producer",
    inviterName: "Jane Admin",
    inviterEmail: "admin@cirque.example",
    // Computed from the real helper (rather than a hand-typed date string) so the
    // Settings preview can never drift from what a real send actually renders: a
    // freshly minted 14-day row's exact expiry day.
    expiresOn: formatExpiresOn(
      new Date(Date.now() + ORG_INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    ),
    isNewUser: true,
    token: "previewtoken1234567890abcdef",
    // A real send always carries a minted action link (see ensureInvitedUser); include one
    // here too so the Settings preview shows the normal reassurance copy, not the no-link
    // fallback that only a rare error path actually sends.
    actionLink: "https://app.showflow.pro/reset-password?redirect=%2Faccept-invite%3Ftoken%3Dpreviewtoken1234567890abcdef",
  },
} satisfies TemplateEntry;
