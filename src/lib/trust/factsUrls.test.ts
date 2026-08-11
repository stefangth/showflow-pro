// facts.ts hardcodes the two public hosts so that scripts/build-trust-json.mjs
// can read it without resolving the "@/" alias. That is a deliberate duplication,
// and this suite is the price of it: if either host moves in app.config.ts and
// not here, the Trust Center starts pointing at the wrong site.

import { describe, expect, it } from "vitest";
import { APP_META, TRUST_CENTER_URL } from "@/config/app.config";
import { DOCUMENTS, TRUST_CONTACT } from "./facts";

describe("trust document links", () => {
  it("uses the hosts declared in APP_META", () => {
    const webLinks = DOCUMENTS.filter((d) => !d.href.startsWith("mailto:"));
    expect(webLinks.length).toBeGreaterThan(0);
    for (const doc of webLinks) {
      const onKnownHost =
        doc.href.startsWith(`${APP_META.APP_URL}/`) ||
        doc.href.startsWith(`${APP_META.MARKETING_URL}/`);
      expect(onKnownHost, `${doc.title} points at an unknown host: ${doc.href}`).toBe(true);
    }
  });

  it("sources the product privacy policy from the app, not the marketing site", () => {
    // The two sites publish different privacy policies. The Trust Center's
    // retention and subprocessor tables are drawn from the app's, so the link
    // must resolve there or a reviewer checking our claims lands on a document
    // that does not contain them.
    const policy = DOCUMENTS.find((d) => d.title === "Privacy policy");
    expect(policy?.href).toBe(`${APP_META.APP_URL}/privacy`);

    const subprocessors = DOCUMENTS.find((d) => d.title === "Subprocessor list");
    expect(subprocessors?.href).toBe(`${APP_META.APP_URL}/privacy`);
  });

  it("sources terms from the marketing site, which is the only host that has them", () => {
    const terms = DOCUMENTS.find((d) => d.title === "Terms of service");
    expect(terms?.href).toBe(`${APP_META.MARKETING_URL}/terms`);
  });

  it("labels the request-only document as a request", () => {
    // The DPA has no published PDF. A "Download" label on a mailto would be a
    // small lie on a page whose entire premise is not telling them.
    const dpa = DOCUMENTS.find((d) => d.href.startsWith("mailto:"));
    expect(dpa?.cta).toBe("Request");
    expect(dpa?.href).toContain(TRUST_CONTACT);
  });

  it("points the in-app link at the marketing site's trust route", () => {
    expect(TRUST_CENTER_URL).toBe(`${APP_META.MARKETING_URL}/trust`);
  });
});
