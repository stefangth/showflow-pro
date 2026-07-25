import { describe, expect, it } from "vitest";
import { computeFeeTotal, feeBreakdownReconciles, feeCents, isFeeBasis } from "./feeBasis";

describe("computeFeeTotal", () => {
  it("returns the amount unchanged for a total basis, whatever the date count", () => {
    expect(computeFeeTotal(1500, 3, "total")).toBe(1500);
    expect(computeFeeTotal(1500, 1, "total")).toBe(1500);
  });

  it("multiplies by the date count for a per-date basis", () => {
    expect(computeFeeTotal(500, 3, "per_date")).toBe(1500);
  });

  it("is exact for amounts with cents (no float drift)", () => {
    // 500.1 * 3 in floating point is 1500.3000000000002.
    expect(computeFeeTotal(500.1, 3, "per_date")).toBe(1500.3);
    expect(computeFeeTotal(33.33, 3, "per_date")).toBe(99.99);
  });

  it("is a no-op for a single date", () => {
    expect(computeFeeTotal(500, 1, "per_date")).toBe(500);
  });

  it("returns the amount unchanged for a nonsensical date count", () => {
    expect(computeFeeTotal(500, 0, "per_date")).toBe(500);
    expect(computeFeeTotal(500, -2, "per_date")).toBe(500);
    expect(computeFeeTotal(500, 1.5, "per_date")).toBe(500);
  });

  it("returns the amount unchanged when it is not finite", () => {
    expect(computeFeeTotal(Number.NaN, 3, "per_date")).toBeNaN();
  });
});

describe("isFeeBasis", () => {
  it("accepts exactly the two legal values", () => {
    expect(isFeeBasis("per_date")).toBe(true);
    expect(isFeeBasis("total")).toBe(true);
  });

  it("rejects absent, blank, and unknown values", () => {
    expect(isFeeBasis(undefined)).toBe(false);
    expect(isFeeBasis(null)).toBe(false);
    expect(isFeeBasis("")).toBe(false);
    expect(isFeeBasis("weekly")).toBe(false);
    expect(isFeeBasis(1)).toBe(false);
  });

  it("rejects prototype-chain members that a plain `in` check would let through", () => {
    expect(isFeeBasis("toString")).toBe(false);
    expect(isFeeBasis("constructor")).toBe(false);
    expect(isFeeBasis("hasOwnProperty")).toBe(false);
  });
});

describe("feeCents", () => {
  it("converts numbers and numeric strings to integer cents", () => {
    expect(feeCents(1500)).toBe(150000);
    expect(feeCents("1500.30")).toBe(150030);
    expect(feeCents(0)).toBe(0);
  });

  it("returns null for an absent or non-numeric amount", () => {
    expect(feeCents(undefined)).toBeNull();
    expect(feeCents(null)).toBeNull();
    // "" must NOT read as 0: Number("") is 0, which would make a blanked fee
    // compare equal to a real zero fee.
    expect(feeCents("")).toBeNull();
    expect(feeCents("abc")).toBeNull();
    expect(feeCents(Number.NaN)).toBeNull();
    expect(feeCents({})).toBeNull();
  });

  it("treats a number and its string spelling as the same amount", () => {
    expect(feeCents("4500.00")).toBe(feeCents(4500));
  });
});

describe("feeBreakdownReconciles", () => {
  it("is true when the per-date amount multiplies up to the total", () => {
    expect(feeBreakdownReconciles(500, 1500, 3)).toBe(true);
    expect(feeBreakdownReconciles("500.00", "1500.00", 3)).toBe(true);
    expect(feeBreakdownReconciles(500, 500, 1)).toBe(true);
  });

  it("is true for fractional amounts that float multiplication would miss", () => {
    // 500.1 * 3 === 1500.3000000000002 in binary floating point, so a float
    // equality check would call this correct breakdown a contradiction.
    expect(feeBreakdownReconciles(500.1, 1500.3, 3)).toBe(true);
  });

  it("is false when the stored total no longer matches the breakdown", () => {
    // The exact shape a fee edit leaves behind: 500 per date x 3 dates, total
    // lowered to 1200.
    expect(feeBreakdownReconciles(500, 1200, 3)).toBe(false);
  });

  it("is false when either amount is absent or unusable", () => {
    expect(feeBreakdownReconciles(undefined, 1500, 3)).toBe(false);
    expect(feeBreakdownReconciles(500, null, 3)).toBe(false);
    expect(feeBreakdownReconciles("", 1500, 3)).toBe(false);
  });

  it("is false for a nonsensical date count", () => {
    expect(feeBreakdownReconciles(500, 1500, 0)).toBe(false);
    expect(feeBreakdownReconciles(500, 1500, -3)).toBe(false);
    expect(feeBreakdownReconciles(500, 1500, 1.5)).toBe(false);
  });
});
