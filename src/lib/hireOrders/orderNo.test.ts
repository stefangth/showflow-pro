import { describe, expect, it } from "vitest";
import { formatOrderNo, withCollisionSuffix } from "./orderNo";

describe("formatOrderNo", () => {
  it("renders the default pattern", () => {
    expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }))
      .toBe("HO-2026-0615-B1");
    expect(formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", seq: 7 }))
      .toBe("HO-2026-0615-7");
  });
});

describe("withCollisionSuffix", () => {
  it("suffixes collisions", () => {
    expect(withCollisionSuffix("HO-2026-0615-B1", 0)).toBe("HO-2026-0615-B1");
    expect(withCollisionSuffix("HO-2026-0615-B1", 1)).toBe("HO-2026-0615-B1-2");
    expect(withCollisionSuffix("HO-2026-0615-B1", 2)).toBe("HO-2026-0615-B1-3");
  });
});
