/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertEquals } from "../../test-asserts.ts";
import { EmailShell } from "./EmailShell.tsx";
import { EMAIL_FAMILY_ACCENTS, EMAIL_THEME_DEFAULTS } from "./emailTheme.ts";

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

  // Brand mark lockup: a hosted white PNG (decorative, alt="") beside the live "ShowFlow"
  // wordmark, so the name still reads when a client blocks images.
  assertStringIncludes(html, "/email/showflow-mark.png");
  assertStringIncludes(html, 'alt=""');
  assertStringIncludes(html, "ShowFlow");
});

Deno.test("EmailShell colors the CTA with the family accent, not the base theme button color", async () => {
  const theme = {
    ...EMAIL_THEME_DEFAULTS,
    base: {
      ...EMAIL_THEME_DEFAULTS.base,
      colors: { ...EMAIL_THEME_DEFAULTS.base.colors, buttonBg: "#1257A6" },
    },
  };
  const html = await renderAsync(
    React.createElement(
      EmailShell,
      {
        family: "pine",
        theme,
        previewText: "Preview text",
        heading: "A booking update",
        footer: "The ShowFlow team",
        cta: { href: "https://app.showflow.pro/availability", label: "Review booking" },
      },
      React.createElement("p", null, "Booking details"),
    ),
  );

  // The CTA takes the family accent (pine), independent of the org-wide base button color.
  assertStringIncludes(html, `background-color:${EMAIL_FAMILY_ACCENTS.pine.buttonBg}`);
  assertEquals(html.includes("#1257A6"), false);
});
