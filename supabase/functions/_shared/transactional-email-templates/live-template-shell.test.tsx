/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertEquals } from "../test-asserts.ts";
import { TEMPLATES } from "./registry.ts";

const LIVE_TEMPLATE_KEYS = [
  "account-email-changed",
  "artist-confirmation-digest",
  "artist-offer-digest",
  "cast-escalation-requested",
  "cron-health-alert",
  "hire-order-countersigned",
  "hire-order-issued",
  "magic-link",
  "offer-expiry-reminder",
  "offer-immediate",
  "org-invitation",
].sort();

Deno.test("the registry contains exactly the eleven live templates with a family", () => {
  assertEquals(Object.keys(TEMPLATES).sort(), LIVE_TEMPLATE_KEYS);
  for (const key of LIVE_TEMPLATE_KEYS) {
    assertEquals(typeof TEMPLATES[key].family, "string", `${key} has a family`);
  }
});

const SHELL_TEMPLATES = [
  { key: "cast-escalation-requested", family: "ember", fallback: "#5F2A1C", detail: "Riverdance" },
  { key: "hire-order-issued", family: "pine", fallback: "#133F31", detail: "HO-2026-0142" },
  { key: "hire-order-countersigned", family: "steel", fallback: "#2A2D48", detail: "HO-2026-0142" },
  { key: "org-invitation", family: "violet", fallback: "#322685", detail: "Cirque Lumière" },
  { key: "account-email-changed", family: "steel", fallback: "#2A2D48", detail: "new@example.com" },
  { key: "cron-health-alert", family: "steel", fallback: "#2A2D48", detail: "send-offer-digest" },
] as const;

for (const expected of SHELL_TEMPLATES) {
  Deno.test(`${expected.key} renders its assigned family through the shared shell`, async () => {
    const entry = TEMPLATES[expected.key];
    const html = await renderAsync(React.createElement(entry.component, entry.previewData ?? {}));

    assertEquals(entry.family, expected.family);
    assertEquals(html.includes(`bgcolor="${expected.fallback}"`), true, "uses the family Outlook fallback");
    assertEquals(html.includes("background-image"), true, "uses the shared hero gradient");
    assertEquals(html.includes('role="presentation"'), true, "uses the shared presentation tables");
    assertEquals(html.includes(expected.detail), true, "preserves preview data");
  });
}
