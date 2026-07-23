/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertEquals } from "../test-asserts.ts";
import { TEMPLATES } from "./registry.ts";

// Every template that renders a link/button into the app. Their CTAs must point at
// the app host (app.showflow.pro), never the marketing site (showflow.pro), which has
// no application routes. artist-confirmation-digest has no app links, so it's excluded.
const APP_LINK_TEMPLATES = [
  "org-invitation",
  "artist-offer-digest",
  "offer-immediate",
  "cast-escalation-requested",
  "new-signup-admin-notification",
  "signup-decision",
  "cron-health-alert",
  "offer-expiry-reminder",
  "hire-order-issued",
  "account-email-changed",
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
