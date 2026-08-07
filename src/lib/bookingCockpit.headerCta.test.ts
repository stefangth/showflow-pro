import { describe, it, expect } from "vitest";
import { computeHeaderCta } from "./bookingCockpit";

describe("computeHeaderCta", () => {
  const base = {
    artistAcceptance: true, acceptedCount: 0, confirmedCount: 0,
    totalSlots: 6, openTier: 1, maxTier: 3,
  };

  it("accepted waiting -> Confirm N", () =>
    expect(computeHeaderCta({ ...base, acceptedCount: 2 })).toEqual({ kind: "confirm", label: "Confirm 2 accepted" }));

  it("classic, room to escalate -> Open next tier", () =>
    expect(computeHeaderCta({ ...base, openTier: 1 })).toEqual({ kind: "openTier", label: "Open tier 2" }));

  it("classic, top tier open -> Review open offers", () =>
    expect(computeHeaderCta({ ...base, openTier: 3 })).toEqual({ kind: "reviewOffers", label: "Review open offers" }));

  it("direct mode, slots to fill -> Book from eligibility", () =>
    expect(computeHeaderCta({ ...base, artistAcceptance: false })).toEqual({ kind: "book", label: "Book from eligibility" }));

  it("all confirmed -> none", () =>
    expect(computeHeaderCta({ ...base, confirmedCount: 6 })).toEqual({ kind: "none", label: "" }));

  it("unconfigured slots -> none", () =>
    expect(computeHeaderCta({ ...base, totalSlots: null })).toEqual({ kind: "none", label: "" }));
});
