import { describe, it, expect } from "vitest";
import { slugify, formatLastActivity } from "./platformFormat";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Circus!")).toBe("acme-circus");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
  });
});

describe("formatLastActivity", () => {
  it("returns an em dash for null", () => {
    expect(formatLastActivity(null)).toBe("—");
  });
  it("formats an ISO date as dd/MM/yyyy", () => {
    expect(formatLastActivity("2026-06-04T10:00:00.000Z")).toBe("04/06/2026");
  });
});
