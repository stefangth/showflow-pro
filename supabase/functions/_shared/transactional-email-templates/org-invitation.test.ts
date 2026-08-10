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
  assert(html.includes("ShowFlow is how Cirque Lumière runs its show production work"), "shows what ShowFlow is for, naming the org");
  assert(html.includes("You are joining as Production Team."), "states the role the invitee is joining as");
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
  assert(!html.includes("You are joining"), "no role statement when role was never resolved");
});

Deno.test("org-invitation email: omits the role paragraph when roleKey has no matching action line (no dangling fragment)", async () => {
  // A role LABEL with no recognized roleKey (e.g. a hand-typed value, or a future role the
  // registry hasn't caught up with) must not render a dangling "You are joining as X."
  // with nothing after it.
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Mystery Role", token: "tok" });
  assert(!html.includes("You are joining"), "no dangling role fragment when the action line is missing");
});

const ACTION_LINK = "https://app.showflow.pro/auth/callback?redirect=%2Faccept-invite";

Deno.test("org-invitation email: reassures a net-new invitee that the button walks them through setting a password", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", isNewUser: true, actionLink: ACTION_LINK });
  assert(
    html.includes("The button opens ShowFlow and asks you to choose a password."),
    "does not claim a one-click sign-in to someone who is about to be asked for a password",
  );
  assert(!html.includes("No password needed"), "does not also show the existing-user reassurance");
});

Deno.test("org-invitation email: defaults to the net-new reassurance when isNewUser was never resolved", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", actionLink: ACTION_LINK });
  assert(
    html.includes("The button opens ShowFlow and asks you to choose a password."),
    "undefined isNewUser defaults to the safer, more common new-account copy",
  );
});

Deno.test("org-invitation email: reassures a returning invitee that the button signs them straight in", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", isNewUser: false, actionLink: ACTION_LINK });
  assert(
    html.includes("The button signs you in directly. No password needed from this email."),
    "an existing account gets the one-click reassurance, not the password-setup one",
  );
  assert(!html.includes("asks you to choose a password"), "does not also show the new-user reassurance");
});

Deno.test("org-invitation email: falls back to an honest sign-in hint when no action link was minted", async () => {
  // The only reachable path that sends this email without an actionLink is
  // create-invitation's catch branch for an already-resolved existing account
  // (isNewUser: false, actionLink omitted): ensureInvitedUser threw AFTER existingUserId
  // resolved, so acceptUrl falls back to the bare token URL, which /accept-invite bounces
  // a session-less visitor to /login for. Neither the "signs you in directly" nor the
  // "asks you to choose a password" claim is true for that URL, so this case must render
  // neither.
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", isNewUser: false });
  assert(
    html.includes("The button takes you to a sign in page."),
    "states the honest fallback behavior instead of a promise the bare token link cannot keep",
  );
  assert(!html.includes("signs you in directly"), "does not claim one-click sign-in without a real action link");
  assert(!html.includes("asks you to choose a password"), "does not claim the account-creation flow without a real action link");
});

Deno.test("org-invitation email: falls back to an honest sign-in hint even when isNewUser was never resolved and there is no action link", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(
    html.includes("The button takes you to a sign in page."),
    "absence of actionLink always wins over the isNewUser default, since the bare token URL cannot keep either promise",
  );
});

Deno.test("org-invitation email: states the real expiry date from the invitation row", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", expiresOn: "August 24, 2026" });
  assert(
    html.includes("This invitation link works until August 24, 2026."),
    "states the concrete expiry date, scoped to the LINK (membership already exists by invite time)",
  );
  assert(!html.includes("This invitation link works for 14 days."), "does not also show the generic fallback once a real date is known");
});

Deno.test("org-invitation email: falls back to a generic expiry statement when no date is known", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok" });
  assert(html.includes("This invitation link works for 14 days."), "every invite states SOME expiry, never silence");
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

Deno.test("org-invitation email: reads product, then role, then expiry, then who invited you, then the button reassurance, then the button, then the paste-link fallback, then the footer", async () => {
  const html = await renderInvite({
    orgName: "Cirque Lumière",
    role: "Production Team",
    roleKey: "producer",
    inviterName: "Jane Admin",
    inviterEmail: "jane@acme.test",
    expiresOn: "August 24, 2026",
    isNewUser: false,
    token: "tok",
    actionLink: ACTION_LINK,
  });
  const iGreeting = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.greeting"]);
  const iProduct = html.indexOf("runs its show production work");
  const iRole = html.indexOf("You are joining as Production Team.");
  const iExpiry = html.indexOf("This invitation link works until August 24, 2026.");
  const iInvitedBy = html.indexOf("Invited by Jane Admin.");
  const iCtaHint = html.indexOf("The button signs you in directly");
  const iCtaLabel = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.ctaLabel"]);
  // The paste-link fallback now lives in EmailShell's postCta slot, below the button: it
  // is a fallback FOR the button, so a reader sees the button first and only reaches the
  // raw URL if the button itself didn't work for them.
  const iPasteLink = html.indexOf(EMAIL_COPY_DEFAULTS["org-invitation.pasteLink"]);
  const iFooter = html.indexOf("If you weren&#x27;t expecting this invitation");

  for (const i of [iGreeting, iProduct, iRole, iExpiry, iInvitedBy, iCtaHint, iCtaLabel, iPasteLink, iFooter]) {
    assert(i >= 0, "every expected section is present in the rendered email");
  }
  assert(iGreeting < iProduct, "greeting precedes the product explanation");
  assert(iProduct < iRole, "product explanation precedes the role explanation");
  assert(iRole < iExpiry, "role explanation precedes the expiry statement");
  assert(iExpiry < iInvitedBy, "expiry statement precedes who invited them");
  assert(iInvitedBy < iCtaHint, "who invited them precedes the button reassurance");
  assert(iCtaHint < iCtaLabel, "the button reassurance sits immediately before the actual accept button");
  assert(iCtaLabel < iPasteLink, "the accept button precedes its paste-link fallback");
  assert(iPasteLink < iFooter, "the paste-link fallback precedes the footer disclaimer");
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
  assert(html.includes("You are joining as Production Team."), "roleIntro drops the org name");
  assert(html.includes("This invitation link works until August 24, 2026."), "expiryLine drops the org name");
});

Deno.test("org-invitation email: the artist role line does not hedge availability behind an undecodable clause", async () => {
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok" });
  assert(!/turned on/i.test(html), "a brand-new artist cannot decode 'where that is turned on'");
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

Deno.test("org-invitation email: the new-account reassurance does not overclaim that setup is finished", async () => {
  // A net-new admin/artist lands on a dashboard onboarding checklist right after this
  // screen (see src/lib/dashboard/firstRun.ts); "That's the whole setup" contradicts that.
  const html = await renderInvite({ orgName: "Cirque Lumière", token: "tok", isNewUser: true, actionLink: ACTION_LINK });
  assertEquals(html.includes("whole setup"), false, "does not promise setup is complete");
  assert(html.includes("That is all you need to get in."), "still reassures about signing in, just scoped to that");
});

Deno.test("org-invitation email: a stored org override for a role action line renders that org's own wording", async () => {
  const copy = { ...EMAIL_COPY_DEFAULTS, "org-invitation.roleIntroArtist": "You will get booking offers by email." };
  const html = await renderInvite({ orgName: "Cirque Lumière", role: "Artist", roleKey: "artist", token: "tok", _emailCopy: copy });
  assert(html.includes("You will get booking offers by email."), "an org's own override for the role action line is honored");
});
