import { describe, expect, it } from "vitest";
import { weekdayOf } from "./render";

// weekdayOf is the only locale-dependent date formatter in the renderer (money
// grouping is covered by money.test.ts). It must localize the weekday name while
// staying deterministic (UTC-pinned).
describe("weekdayOf locale", () => {
  const DATE = "2026-05-04"; // an arbitrary fixed calendar date

  it("localizes the weekday name to the requested locale", () => {
    const expectedEn = new Date(`${DATE}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      timeZone: "UTC",
    });
    const expectedDe = new Date(`${DATE}T00:00:00Z`).toLocaleDateString("de-DE", {
      weekday: "long",
      timeZone: "UTC",
    });
    expect(weekdayOf(DATE, "en")).toBe(expectedEn);
    expect(weekdayOf(DATE, "de")).toBe(expectedDe);
    expect(weekdayOf(DATE, "de")).not.toBe(weekdayOf(DATE, "en"));
  });

  it("defaults to English when no locale is given (byte-identical to before)", () => {
    expect(weekdayOf(DATE)).toBe(weekdayOf(DATE, "en"));
  });

  it("returns empty string for a malformed date, in either locale", () => {
    expect(weekdayOf("not-a-date", "de")).toBe("");
    expect(weekdayOf("", "en")).toBe("");
  });
});
