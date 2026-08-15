import { describe, expect, it } from "vitest";
import {
  applyTokens,
  HIRE_ORDER_COPY_DE,
  HIRE_ORDER_COPY_DEFAULTS,
  resolveHireOrderCopy,
  type CopyKey,
} from "./pdfCopy";

describe("applyTokens", () => {
  it("substitutes known tokens", () => {
    expect(applyTokens("Booking agent: {{agent_name}}", { agent_name: "Jo" }))
      .toBe("Booking agent: Jo");
  });
  it("coerces numbers", () => {
    expect(applyTokens("{{count}} dates", { count: 3 })).toBe("3 dates");
  });
  it("leaves unknown tokens verbatim (no blanking, no injection)", () => {
    expect(applyTokens("Hi {{typo}}", { agent_name: "Jo" })).toBe("Hi {{typo}}");
  });
  it("replaces every occurrence of a repeated token", () => {
    expect(applyTokens("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });
});

describe("resolveHireOrderCopy", () => {
  it("returns defaults when no overrides", () => {
    expect(resolveHireOrderCopy()).toEqual(HIRE_ORDER_COPY_DEFAULTS);
    expect(resolveHireOrderCopy(null)).toEqual(HIRE_ORDER_COPY_DEFAULTS);
  });
  it("applies a non-empty override per key", () => {
    const r = resolveHireOrderCopy({ terms_heading: "Conditions" });
    expect(r.terms_heading).toBe("Conditions");
    expect(r.title_lead).toBe(HIRE_ORDER_COPY_DEFAULTS.title_lead);
  });
  it("falls back to default for empty/whitespace overrides", () => {
    expect(resolveHireOrderCopy({ terms_heading: "   " }).terms_heading)
      .toBe(HIRE_ORDER_COPY_DEFAULTS.terms_heading);
  });
  it("returns a fresh object (no mutation of the defaults)", () => {
    const r = resolveHireOrderCopy({ terms_heading: "X" });
    expect(r).not.toBe(HIRE_ORDER_COPY_DEFAULTS);
    expect(HIRE_ORDER_COPY_DEFAULTS.terms_heading).toBe("Terms & conditions");
  });
  it("has no em/en dashes in any default", () => {
    for (const v of Object.values(HIRE_ORDER_COPY_DEFAULTS)) {
      expect(v).not.toMatch(/[–—]/);
    }
  });
  it("keeps interpolation tokens in the defaults that need them", () => {
    const k: CopyKey = "party_agent";
    expect(HIRE_ORDER_COPY_DEFAULTS[k]).toContain("{{agent_name}}");
  });
});

const pdfTokensOf = (s: string): string[] =>
  (s.match(/\{\{(\w+)\}\}/g) ?? []).slice().sort();

describe("HIRE_ORDER_COPY_DE (German base)", () => {
  it("has exactly the same keys as HIRE_ORDER_COPY_DEFAULTS", () => {
    expect(Object.keys(HIRE_ORDER_COPY_DE).slice().sort()).toEqual(
      Object.keys(HIRE_ORDER_COPY_DEFAULTS).slice().sort(),
    );
  });

  it("preserves every {{token}} placeholder from the English twin", () => {
    for (const key of Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]) {
      expect(pdfTokensOf(HIRE_ORDER_COPY_DE[key]), `tokens for ${key}`).toEqual(
        pdfTokensOf(HIRE_ORDER_COPY_DEFAULTS[key]),
      );
    }
  });

  it("uses no em or en dashes (house rule)", () => {
    for (const [key, value] of Object.entries(HIRE_ORDER_COPY_DE)) {
      expect(value, `dash in ${key}`).not.toMatch(/[–—]/);
    }
  });

  it("uses the informal Du, never the formal Sie/Ihr, in reader-facing lines", () => {
    for (const [key, value] of Object.entries(HIRE_ORDER_COPY_DE)) {
      expect(value, `formal address in ${key}`).not.toMatch(
        /\b(Sie|Ihre?|Ihnen|Ihrem|Ihren|Ihres)\b/,
      );
    }
  });

  it("uses a literal ampersand in the fees heading, matching the English default (react-pdf renders text literally, so no HTML entity)", () => {
    expect(HIRE_ORDER_COPY_DEFAULTS.fees_heading).toBe("Fees & payment schedule");
    expect(HIRE_ORDER_COPY_DE.fees_heading).toBe("Honorar & Zahlungsplan");
    expect(HIRE_ORDER_COPY_DE.fees_heading).not.toContain("&amp;");
  });
});

describe("resolveHireOrderCopy locale selection", () => {
  it("defaults to English, byte-identical to the defaults", () => {
    expect(resolveHireOrderCopy()).toEqual({ ...HIRE_ORDER_COPY_DEFAULTS });
    expect(resolveHireOrderCopy(undefined, "en")).toEqual({ ...HIRE_ORDER_COPY_DEFAULTS });
  });

  it("returns the German base when locale is 'de'", () => {
    expect(resolveHireOrderCopy(undefined, "de")).toEqual({ ...HIRE_ORDER_COPY_DE });
  });

  it("layers a sparse per-org override over the German base", () => {
    const out = resolveHireOrderCopy({ header_eyebrow: "X" }, "de");
    expect(out.header_eyebrow).toBe("X");
    expect(out.terms_heading).toBe(HIRE_ORDER_COPY_DE.terms_heading);
  });
});
