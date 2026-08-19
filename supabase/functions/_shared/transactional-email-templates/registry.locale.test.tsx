/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { assertEquals, assertExists } from "../test-asserts.ts";
import { resolveTemplatePresentation, TEMPLATES } from "./registry.ts";
import { EMAIL_COPY_DE, EMAIL_COPY_DEFAULTS } from "./_shell/emailCopy.ts";

const OFFER_DATA = { displayName: "Jane", referenceLabel: "Candlelight", date: "2026-04-30", city: "Berlin" };

Deno.test("presentation: locale 'de' selects German copy, subject, and _emailLocale", () => {
  const p = resolveTemplatePresentation("offer-immediate", OFFER_DATA, { locale: "de" });
  assertExists(p);
  assertEquals(p.props._emailLocale, "de");
  assertEquals(p.copy["offer-immediate.heading"], EMAIL_COPY_DE["offer-immediate.heading"]);
  // Subject resolves from the German base ("Kannst Du ...").
  assertEquals(p.subject.startsWith("Kannst Du"), true);
});

Deno.test("presentation: default locale is English and stays byte-identical", () => {
  const p = resolveTemplatePresentation("offer-immediate", OFFER_DATA);
  assertExists(p);
  assertEquals(p.props._emailLocale, "en");
  assertEquals(p.copy["offer-immediate.heading"], EMAIL_COPY_DEFAULTS["offer-immediate.heading"]);
  assertEquals(p.subject.startsWith("Can you do"), true);
});

Deno.test("render: a German presentation produces <html lang=\"de\"> and German body copy", async () => {
  const p = resolveTemplatePresentation("offer-immediate", OFFER_DATA, { locale: "de" });
  assertExists(p);
  const html = await renderAsync(
    React.createElement(TEMPLATES["offer-immediate"].component, p.props),
  );
  assertEquals(html.includes('lang="de"'), true);
  assertEquals(html.includes(EMAIL_COPY_DE["offer-immediate.heading"]), true);
});

Deno.test("render: the default (English) presentation still produces <html lang=\"en\">", async () => {
  const p = resolveTemplatePresentation("offer-immediate", OFFER_DATA);
  assertExists(p);
  const html = await renderAsync(
    React.createElement(TEMPLATES["offer-immediate"].component, p.props),
  );
  assertEquals(html.includes('lang="en"'), true);
  assertEquals(html.includes(EMAIL_COPY_DEFAULTS["offer-immediate.heading"]), true);
});
