import { describe, expect, it } from "vitest";
import { formatOrderNo, withCollisionSuffix } from "./orderNo";

describe("formatOrderNo", () => {
  it("renders the legacy {cast|seq} pattern (castCode when present, else seq)", () => {
    expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }))
      .toBe("HO-2026-0615-B1");
    expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", seq: 7 }))
      .toBe("HO-2026-0615-7");
  });

  it("renders {seq} as the numeric sequence regardless of castCode", () => {
    expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }))
      .toBe("HO-2026-0615-7");
    expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{seq}", { prefix: "HO", date: "2026-06-15", seq: 7 }))
      .toBe("HO-2026-0615-7");
  });

  it("renders {cast} as the code when present, else empty string", () => {
    expect(formatOrderNo("{prefix}-{cast}{seq}", { prefix: "HO", castCode: "B1", seq: 3 }))
      .toBe("HO-B13");
    expect(formatOrderNo("{prefix}-{cast}{seq}", { prefix: "HO", seq: 3 }))
      .toBe("HO-3");
  });

  it("gives every artist on a date a DISTINCT number under the default {seq} pattern", () => {
    const pattern = "{prefix}-{yyyy}-{mmdd}-{seq}";
    const nums = [1, 2, 3, 4, 5, 6].map((seq) =>
      formatOrderNo(pattern, { prefix: "HO", date: "2026-06-15", castCode: "AIDA", seq }));
    expect(new Set(nums).size).toBe(6);
    expect(nums).toEqual([
      "HO-2026-0615-1", "HO-2026-0615-2", "HO-2026-0615-3",
      "HO-2026-0615-4", "HO-2026-0615-5", "HO-2026-0615-6",
    ]);
  });
});

describe("withCollisionSuffix", () => {
  it("suffixes collisions", () => {
    expect(withCollisionSuffix("HO-2026-0615-B1", 0)).toBe("HO-2026-0615-B1");
    expect(withCollisionSuffix("HO-2026-0615-B1", 1)).toBe("HO-2026-0615-B1-2");
    expect(withCollisionSuffix("HO-2026-0615-B1", 2)).toBe("HO-2026-0615-B1-3");
  });
});
