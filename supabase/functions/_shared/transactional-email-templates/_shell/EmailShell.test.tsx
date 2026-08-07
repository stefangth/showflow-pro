/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertEquals } from "../../test-asserts.ts";
import { EmailShell } from "./EmailShell.tsx";
import { EMAIL_THEME_DEFAULTS } from "./emailTheme.ts";

Deno.test("EmailShell renders a resilient violet hero without unsupported layout CSS", async () => {
  const html = await renderAsync(
    React.createElement(
      EmailShell,
      {
        family: "violet",
        theme: EMAIL_THEME_DEFAULTS,
        previewText: "Preview text",
        heading: "A booking update",
        subheading: "Please review the details below.",
        footer: "The ShowFlow team",
        cta: { href: "https://app.showflow.pro/availability", label: "Review booking" },
      },
      React.createElement("p", null, "Booking details"),
    ),
  );

  assertStringIncludes(html, 'bgcolor="#322685"');
  assertStringIncludes(html, "background-image");
  assertStringIncludes(html, 'name="color-scheme"');
  assertStringIncludes(html, 'role="presentation"');
  assertEquals(html.includes("backdrop-filter"), false);
  assertEquals(html.includes("display:flex"), false);
});
