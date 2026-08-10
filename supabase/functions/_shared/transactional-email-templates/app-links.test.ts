/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertEquals } from "../test-asserts.ts";
import { TEMPLATES } from "./registry.ts";
import { resolveEmailCopy } from "./_shell/emailCopy.ts";
import { resolveEmailTheme } from "./_shell/emailTheme.ts";

// Every template that renders a link/button into the app. Their CTAs must point at
// the app host (app.showflow.pro), never the marketing site (showflow.pro), which has
// no application routes. artist-confirmation-digest has no app links, so it's excluded.
const APP_LINK_TEMPLATES = [
  "org-invitation",
  "artist-offer-digest",
  "offer-immediate",
  "cast-escalation-requested",
  "cron-health-alert",
  "offer-expiry-reminder",
  "hire-order-issued",
  "account-email-changed",
  "airtable-sync-held",
];

for (const name of APP_LINK_TEMPLATES) {
  Deno.test(`email template "${name}" links to the app host, not the marketing site`, async () => {
    const entry = TEMPLATES[name];
    const html = await renderAsync(
      React.createElement(entry.component, entry.previewData ?? {}),
    );
    assertEquals(
      html.includes("//showflow.pro"),
      false,
      `${name} must not link to the marketing origin //showflow.pro`,
    );
    assertEquals(
      html.includes("//app.showflow.pro"),
      true,
      `${name} should link to the app origin //app.showflow.pro`,
    );
  });
}

// The org-invitation accept link is the reported regression: it must carry the token
// on the app host so /accept-invite resolves.
Deno.test("org-invitation builds the accept link on the app host with the token", async () => {
  const entry = TEMPLATES["org-invitation"];
  const html = await renderAsync(
    React.createElement(entry.component, { token: "tok_abc123" }),
  );
  assertEquals(
    html.includes("https://app.showflow.pro/accept-invite?token=tok_abc123"),
    true,
    "accept link must be app.showflow.pro/accept-invite?token=<token>",
  );
});

const BOOKING_TEMPLATES = [
  {
    name: "offer-immediate",
    detail: "Candlelight · Strings",
    headingKey: "offer-immediate.heading",
    ctaKey: "offer-immediate.ctaLabel",
    hasCta: true,
  },
  {
    name: "artist-offer-digest",
    detail: "Riverdance",
    headingKey: "artist-offer-digest.heading",
    ctaKey: "artist-offer-digest.ctaLabel",
    hasCta: true,
  },
  {
    name: "offer-expiry-reminder",
    detail: "Candlelight · Strings",
    headingKey: "offer-expiry-reminder.headingSingular",
    ctaKey: "offer-expiry-reminder.ctaLabelSingular",
    hasCta: true,
  },
  {
    name: "artist-confirmation-digest",
    detail: "Venue flooded",
    headingKey: "artist-confirmation-digest.headingUpdates",
    hasCta: false,
  },
] as const;

for (const booking of BOOKING_TEMPLATES) {
  Deno.test(`booking template "${booking.name}" renders the shared violet shell and dynamic data`, async () => {
    const entry = TEMPLATES[booking.name];
    const html = await renderAsync(React.createElement(entry.component, entry.previewData ?? {}));

    assertEquals(html.includes('bgcolor="#322685"'), true, `${booking.name} has the violet Outlook fallback`);
    assertEquals(html.includes("background-image"), true, `${booking.name} uses the shared hero gradient`);
    assertEquals(html.includes('role="presentation"'), true, `${booking.name} uses presentation tables`);
    assertEquals(html.includes(booking.detail), true, `${booking.name} preserves its preview row data`);
    if (booking.hasCta) {
      assertEquals(html.includes("https://app.showflow.pro/availability"), true, `${booking.name} CTA points to the app`);
    }
  });

  Deno.test(`booking template "${booking.name}" accepts custom presentation props`, async () => {
    const entry = TEMPLATES[booking.name];
    const copy = resolveEmailCopy({
      [booking.headingKey]: "Editor heading",
      ...(booking.hasCta && booking.ctaKey ? { [booking.ctaKey]: "Editor CTA" } : {}),
    });
    const theme = resolveEmailTheme({ roles: { heading: { size: 31 } } });
    const html = await renderAsync(React.createElement(entry.component, {
      ...(entry.previewData ?? {}),
      _emailCopy: copy,
      _emailTheme: theme,
      _emailFamily: "ember",
      _highlightRole: "heading",
    }));

    assertEquals(html.includes("Editor heading"), true, `${booking.name} uses custom heading copy`);
    assertEquals(html.includes("font-size:31px"), true, `${booking.name} uses custom theme styles`);
    assertEquals(html.includes("outline:2px solid"), true, `${booking.name} highlights the selected role in previews`);
    assertEquals(html.includes('bgcolor="#5F2A1C"'), true, `${booking.name} uses its custom family fallback`);
    if (booking.hasCta) assertEquals(html.includes("Editor CTA"), true, `${booking.name} uses custom CTA copy`);
  });
}
