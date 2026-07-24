import { describe, expect, it } from "vitest";
import {
  applyTokens,
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
