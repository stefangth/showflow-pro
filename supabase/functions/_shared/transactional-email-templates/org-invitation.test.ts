/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { template } from "./org-invitation.tsx";
import { EMAIL_COPY_DEFAULTS } from "./_shell/emailCopy.ts";

async function renderInvite(props: Record<string, unknown>): Promise<string> {
  const { render } = await import("npm:@react-email/render@1.0.1");
  return await render(React.createElement(template.component, props));
}

Deno.test("org-invitation email: explains the product and, when the role is known, the role", async () => {
  const html = await renderInvite({
    orgName: "Cirque Lumière",
    role: "Production Team",
    roleKey: "producer",
    token: "tok",
  });
  assert(html.includes("ShowFlow is where Cirque Lumière plans its shows and books the artists for them"), "shows what ShowFlow is for, naming the org");
  assert(html.includes("Your role is Production Team."), "states the invitee's role");
  assert(
    html.includes("You plan productions and show dates, and book artists into them."),
    "explains what the role can do",
  );
});

Deno.test("org-invitation email: states the role name exactly once", async () => {
  const html = await renderInvite({
    orgName: "Cirque Lumière",
    role: "Production Team",
    roleKey: "producer",
    token: "tok",
  });
  const occurrences = html.split("Production Team").length - 1;
  assertEquals(occurrences, 1, "the role name appears exactly once");
});

Deno.test("org-invitation email: omits the role paragraph entirely when the role is unknown", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(!html.includes("Your role is"), "no role statement when role was never resolved");
});

Deno.test("org-invitation email: omits the role paragraph when roleKey has no matching action line (no dangling fragment)", async () => {
  // A role LABEL with no recognized roleKey (e.g. a hand-typed value, or a future role the
  // registry hasn't caught up with) must not render a dangling "Your role is X." with
  // nothing after it.
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Mystery Role", token: "tok" });
  assert(!html.includes("Your role is"), "no dangling role fragment when the action line is missing");
});

Deno.test("org-invitation email: gives one unified sign-in or account-creation hint", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(
    html.includes("Continue securely to sign in or create your account."),
    "does not promise that the emailed link signs in directly or sets a password",
  );
});

Deno.test("org-invitation email: CTA and paste fallback use only the durable token URL", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "stable token/+" });
  const stableUrl = "https://app.showflow.pro/accept-invite?token=stable%20token%2F%2B";
  assert(html.includes(stableUrl), "renders the encoded stable invitation URL");
  assert(!html.includes("auth/callback"), "does not embed a short-lived Auth action link");
});

Deno.test("org-invitation email: the recovery hint (what to do if this doesn't work) lives once, beside the paste-link fallback, not duplicated on the button reassurance", async () => {
  // Regression: ctaHintNewUser/ctaHintExistingUser used to end with "If it ever stops
  // working, ask whoever invited you to send a fresh one."; that clause now lives only
  // in linkRecovery, rendered after the paste-link fallback below the button.
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(html.includes(EMAIL_COPY_DEFAULTS["org-invitation.linkRecovery"]), "the recovery hint renders");
  const occurrences = html.split("send a fresh").length - 1;
  assertEquals(occurrences, 1, "the recovery language appears exactly once, not duplicated on the button reassurance");
});

Deno.test("org-invitation email: states the real expiry date from the invitation row", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", expiresOn: "August 24, 2026" });
  assert(
    html.includes("Your invitation is valid until August 24, 2026. If the sign-in button stops working, ask for it to be resent."),
    "states the concrete expiry date, scoped to the INVITATION (the emailed action link's own TTL is shorter and unrelated)",
  );
  assert(
    !html.includes(EMAIL_COPY_DEFAULTS["org-invitation.expiryFallback"]),
    "does not also show the generic fallback once a real date is known",
  );
});

Deno.test("org-invitation email: falls back to a generic expiry statement when no date is known", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(
    html.includes(EMAIL_COPY_DEFAULTS["org-invitation.expiryFallback"]),
    "every invite states SOME expiry, never silence",
  );
});

Deno.test("org-invitation email: the expiry statement never claims the emailed link itself stays valid for the stated window", async () => {
  // The rendered CTA/paste-link is a short-lived Supabase action link (magiclink or
  // invite, see ensureInvitedUser in _shared/invitations.ts) that typically expires in
  // hours and is consumed on first use: much shorter than, and unrelated to, the 14-day
  // window accept_invitation actually checks. A reader who opens this email on day 3 and
  // is told "the link ... works until day 14" would click a dead link with no
  // explanation. The statement must be scoped to the invitation, never the link.
  const withDate = await renderInvite({ orgName: "Cirque Lumière", token: "tok", expiresOn: "August 24, 2026" });
  assert(!withDate.toLowerCase().includes("the link in this email works"), "does not claim the emailed link itself stays valid");
  const withoutDate = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(!withoutDate.toLowerCase().includes("the link in this email works"), "does not claim the emailed link itself stays valid (fallback copy)");
});

Deno.test("org-invitation email: invited-by line prefers the inviter's display name over their email", async () => {
  const html = await renderInvite({
    orgName: "Cirque Lumière", token: "tok",
    inviterName: "Jane Admin", inviterEmail: "jane@acme.test",
  });
  assert(html.includes("Invited by Jane Admin."), "prefers the friendly display name");
  assert(!html.includes("Invited by jane@acme.test."), "does not also show the raw email once a name is known");
});

Deno.test("org-invitation email: invited-by line falls back to the inviter's email when no display name exists", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", inviterEmail: "jane@acme.test" });
  assert(html.includes("Invited by jane@acme.test."), "falls back to the email when no display name was resolvable");
});

Deno.test("org-invitation email: omits the invited-by line entirely when there is no inviter to name", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(!html.includes("Invited by"), "no dangling 'Invited by' line when neither name nor email is known");
});

Deno.test("org-invitation email: footer stays generic, expiry wording lives in the body now", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", expiresOn: "August 24, 2026" });
  // react-email's renderer HTML-entity-encodes apostrophes (' -> &#x27;), so the
  // assertion matches the actual rendered markup rather than the raw copy string.
  assert(
    html.includes("If you weren&#x27;t expecting this invitation, you can safely ignore this email."),
    "keeps the safe-to-ignore disclaimer",
  );
});

Deno.test("org-invitation email: reads product, then role, then expiry, then who invited you, then the button reassurance, then the button, then the paste-link fallback, then the link-recovery hint, then the footer", async () => {
  const html = await renderInvite({
    orgName: "Cirque Lumière",
    role: "Production Team",
    roleKey: "producer",
    inviterName: "Jane Admin",
    inviterEmail: "jane@acme.test",
    expiresOn: "August 24, 2026",
    token: "tok",
  });
  const iGreeting = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.greeting"]);
  const iProduct = html.indexOf("plans its shows and books the artists for them");
  const iRole = html.indexOf("Your role is Production Team.");
  const iExpiry = html.indexOf("Your invitation is valid until August 24, 2026. If the sign-in button stops working, ask for it to be resent.");
  const iInvitedBy = html.indexOf("Invited by Jane Admin.");
  const iCtaHint = html.indexOf("Continue securely to sign in or create your account.");
  const iCtaLabel = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.ctaLabel"]);
  // The paste-link fallback and the link-recovery hint both live in EmailShell's postCta
  // slot, below the button: they are fallbacks FOR the button, so a reader sees the
  // button first and only reaches this material if the button itself didn't work.
  const iPasteLink = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.pasteLink"]);
  const iLinkRecovery = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.linkRecovery"]);
  const iFooter = html.indexOf("If you weren&#x27;t expecting this invitation");

  for (const i of [iGreeting, iProduct, iRole, iExpiry, iInvitedBy, iCtaHint, iCtaLabel, iPasteLink, iLinkRecovery, iFooter]) {
    assert(i >= 0, "every expected section is present in the rendered email");
  }
  assert(iGreeting < iProduct, "greeting precedes the product explanation");
  assert(iProduct < iRole, "product explanation precedes the role explanation");
  assert(iRole < iExpiry, "role explanation precedes the expiry statement");
  assert(iExpiry < iInvitedBy, "expiry statement precedes who invited them");
  assert(iInvitedBy < iCtaHint, "who invited them precedes the button reassurance");
  assert(iCtaHint < iCtaLabel, "the button reassurance sits immediately before the actual accept button");
  assert(iCtaLabel < iPasteLink, "the accept button precedes its paste-link fallback");
  assert(iPasteLink < iLinkRecovery, "the paste-link fallback precedes the link-recovery hint");
  assert(iLinkRecovery < iFooter, "the link-recovery hint precedes the footer disclaimer");
});

Deno.test("org-invitation email: does not repeat the org name in three consecutive body sentences", async () => {
  // Previously productIntro, roleIntro, and expiryLine all named the org back to back
  // ("ShowFlow is where Acme plans shows..." / "You are joining Acme on the X side." /
  // "Your invitation to join Acme is held until..."). Only productIntro should still, so
  // check the role and expiry sentences specifically rather than counting every
  // occurrence of the org name in the whole email (the subject/heading/preview text
  // legitimately name the org too, outside the three body sentences this test is about).
  const html = await renderInvite({
    orgName: "Cirque Lumière",
    role: "Production Team",
    roleKey: "producer",
    expiresOn: "August 24, 2026",
    token: "tok",
  });
  assert(html.includes("Your role is Production Team."), "roleIntro drops the org name");
  assert(html.includes("Your invitation is valid until August 24, 2026. If the sign-in button stops working, ask for it to be resent."), "expiryLine drops the org name");
});

Deno.test("org-invitation email: the artist role line does not hedge availability behind an undecodable clause", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok" });
  assert(!/turned on/i.test(html), "a brand-new artist cannot decode 'where that is turned on'");
});

Deno.test("org-invitation email: an artist invite stays flow-neutral by default, since offersExpected must be PROVEN true, not assumed", async () => {
  // offersExpected omitted entirely. Regression for the INVERSE gap: the template used
  // to default to the offers-aware line whenever artistAcceptance was anything but
  // explicitly false, which meant an unentitled or still-paused org (both of which
  // resolveArtistOffersExpected, _shared/invitations.ts, resolves to false) would have
  // rendered a promise ("you will get emailed offers") that could never come true. The
  // caller (create-invitation/resend-invitation/provision-org) is the one place that
  // actually knows whether offers are coming; the template must not assume it.
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok" });
  assert(html.includes(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"]), "renders the flow-neutral action line by default");
  assert(!html.includes(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtistOffers"]), "does not also render the offers-aware line");
  assert(html.includes("You are on the roster."), "renders the new roster framing shared by both artist lines");
  assert(
    !EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"].toLowerCase().includes("email"),
    "flow-neutral line makes no offer promise (renders for direct-book/paused/unentitled orgs too)",
  );
});

Deno.test("org-invitation email: offersExpected: true renders the offers-aware line, for the (majority) org where it is actually confirmed", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok", offersExpected: true });
  assert(html.includes(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtistOffers"]), "renders the offers-aware action line");
  assert(!html.includes(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"]), "does not also render the flow-neutral line");
  assert(
    html.includes("booking offers by email, accept or decline each in one tap"),
    "offers line carries the by-email, one-tap benefit that the flow-neutral line withholds",
  );
});

Deno.test("org-invitation email: offersExpected: false never claims an offer step the org does not have", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok", offersExpected: false });
  assert(html.includes(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"]), "renders the flattened, flow-neutral action line instead");
  assertEquals(html.toLowerCase().includes("offer"), false, "an org with no confirmed offer step must not have the email claim one");
});

Deno.test("org-invitation email: offersExpected is irrelevant for a non-artist role", async () => {
  // A true offersExpected must not leak into the admin/producer action lines, which
  // never branch on it.
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Production Team", roleKey: "producer", token: "tok", offersExpected: true });
  assert(html.includes("You plan productions and show dates, and book artists into them."), "producer line is unaffected by offersExpected");
});

Deno.test("org-invitation email: preview data renders every section without a stray {{token}} placeholder", async () => {
  const html = await renderInvite(template.previewData ?? {});
  assertEquals(/\{\{\w+\}\}/.test(html), false, "no unresolved token placeholder leaks into the rendered preview");
});

Deno.test("org-invitation email: the default product intro never claims a specific booking flow (offers)", async () => {
  // booking_flow.artist_acceptance is a per-org toggle (see _shared/bookingFlow.ts) and a
  // direct-book org never opens an offer at all, so an invitation sent to every org's
  // invitees, regardless of that org's flow, must not assert "sends booking offers" as fact.
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assertEquals(html.toLowerCase().includes("offer"), false, "no offer-specific claim in the default copy");
});

Deno.test("org-invitation email: the unified hint does not overclaim that setup is finished", async () => {
  // A net-new admin/artist lands on a dashboard onboarding checklist right after this
  // screen (see src/lib/dashboard/firstRun.ts); "That's the whole setup" contradicts that.
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assertEquals(html.includes("whole setup"), false, "does not promise setup is complete");
  assert(html.includes("Continue securely to sign in or create your account."), "uses the unified truthful hint");
});

Deno.test("org-invitation email: a stored org override for a role action line renders that org's own wording", async () => {
  const copy = { ...EMAIL_COPY_DEFAULTS, "org-invitation.roleIntroArtist": "You will always be booked directly, no offers involved." };
  // offersExpected omitted (the default) selects the flow-neutral roleIntroArtist line
  // (the one overridden here) rather than the offers-aware roleIntroArtistOffers.
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok", _emailCopy: copy });
  assert(html.includes("You will always be booked directly, no offers involved."), "an org's own override for the role action line is honored");
});
