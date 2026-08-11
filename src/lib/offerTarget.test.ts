import { describe, it, expect } from "vitest";
import type { TierCast } from "@/data/tierLadder";
import { resolveNextOfferTarget, nextOfferButtonLabel } from "./offerTarget";

const tierMap: TierCast[] = [
  { tier: 1, casts: [{ id: "cast-a", name: "Cast A" }] },
  { tier: 2, casts: [{ id: "cast-b", name: "Cast B" }] },
  { tier: 3, casts: [{ id: "cast-c", name: "Cast C" }, { id: "cast-d", name: "Cast D" }] },
];

describe("resolveNextOfferTarget", () => {
  it("names the cast when the tier maps to exactly one", () => {
    expect(resolveNextOfferTarget(tierMap, 2)).toEqual({
      kind: "cast", tier: 2, cast: { id: "cast-b", name: "Cast B" },
    });
  });

  it("falls back to the tier label for a multi-cast tier", () => {
    expect(resolveNextOfferTarget(tierMap, 3)).toEqual({ kind: "tier", tier: 3 });
  });

  it("falls back to the tier label for tier 99 (ad-hoc)", () => {
    expect(resolveNextOfferTarget(tierMap, 99)).toEqual({ kind: "tier", tier: 99 });
  });

  it("falls back to the tier label when the tier has no ladder row at all", () => {
    expect(resolveNextOfferTarget(tierMap, 7)).toEqual({ kind: "tier", tier: 7 });
  });
});

describe("nextOfferButtonLabel", () => {
  it("names the cast with a headcount suffix when one is given", () => {
    expect(
      nextOfferButtonLabel({ kind: "cast", tier: 2, cast: { id: "cast-b", name: "Cast B" } }, 7),
    ).toBe("Open offers to Cast B (7 artists)");
  });

  it("names the cast with no suffix when headcount is omitted", () => {
    expect(
      nextOfferButtonLabel({ kind: "cast", tier: 2, cast: { id: "cast-b", name: "Cast B" } }),
    ).toBe("Open offers to Cast B");
  });

  it("falls back to the tier label", () => {
    expect(nextOfferButtonLabel({ kind: "tier", tier: 3 })).toBe("Open tier 3");
  });

  it("falls back to ad-hoc casts at tier 99", () => {
    expect(nextOfferButtonLabel({ kind: "tier", tier: 99 })).toBe("Open ad-hoc casts");
  });

  it("ignores a headcount given for the tier fallback (only cast targets show a count)", () => {
    expect(nextOfferButtonLabel({ kind: "tier", tier: 3 }, 5)).toBe("Open tier 3");
  });
});
