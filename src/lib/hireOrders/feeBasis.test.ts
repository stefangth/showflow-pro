import { describe, expect, it } from "vitest";
import { computeFeeTotal } from "./feeBasis";

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
