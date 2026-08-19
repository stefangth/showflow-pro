import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { computeHeaderCta } from "./bookingCockpit";

// Copy comes from the `bookingCopy` namespace; an English `t` in the shared `base` pins
// the byte-identical English output (every spread inherits it).
const t = i18n.getFixedT("en", "bookingCopy");

describe("computeHeaderCta", () => {
  // currentTierOpen:false = the highest opened tier has closed short, so escalation
  // is appropriate. A tier still open (awaiting responses) sets it true.
  // nextTier is caller-supplied and gap-aware (the smallest ladder tier strictly
  // greater than the highest opened tier) — computeHeaderCta no longer derives it
  // from openTier/maxTier, so a non-contiguous ladder (e.g. tiers {1, 3}) still
  // resolves to the right next tier upstream, before this function ever sees it.
  const base = {
    artistAcceptance: true, acceptedCount: 0, confirmedCount: 0,
    totalSlots: 6, currentTierOpen: false, nextTier: 2 as number | null, t,
  };

  it("accepted waiting -> Confirm N", () =>
    expect(computeHeaderCta({ ...base, acceptedCount: 2 })).toEqual({ kind: "confirm", label: "Book 2 who said yes" }));

  it("classic, current tier closed short with room to escalate -> Open next tier", () =>
    expect(computeHeaderCta({ ...base, nextTier: 2 })).toEqual({ kind: "openTier", label: "Open round 2" }));

  it("classic, no tier ever opened -> Open tier 1", () =>
    expect(computeHeaderCta({ ...base, nextTier: 1 })).toEqual({ kind: "openTier", label: "Open round 1" }));

  it("classic, current tier still open awaiting responses -> Review open offers (no premature escalation)", () =>
    expect(computeHeaderCta({ ...base, currentTierOpen: true })).toEqual({ kind: "reviewOffers", label: "Review who's been asked" }));

  it("classic, every ladder tier already opened (nextTier null) -> Review open offers", () =>
    expect(computeHeaderCta({ ...base, nextTier: null })).toEqual({ kind: "reviewOffers", label: "Review who's been asked" }));

  // Gap-aware: a non-contiguous ladder (tiers 1 and 3, tier 1 opened) resolves
  // nextTier to 3 upstream (skipping the gap at 2) — computeHeaderCta just has to
  // offer whatever nextTier it's handed, proving it never re-derives ((openTier ?? 0) + 1)
  // itself.
  it("gapped ladder: nextTier 3 (tier 2 doesn't exist) -> Open tier 3", () =>
    expect(computeHeaderCta({ ...base, nextTier: 3 })).toEqual({ kind: "openTier", label: "Open round 3" }));

  it("gapped ladder with a resolved cast name -> Open offers to Cast C", () =>
    expect(computeHeaderCta({ ...base, nextTier: 3, nextTierCastName: "Cast C" }))
      .toEqual({ kind: "openTier", label: "Ask Cast C" }));

  it("direct mode, slots to fill -> Book from eligibility", () =>
    expect(computeHeaderCta({ ...base, artistAcceptance: false })).toEqual({ kind: "book", label: "Book from who can be asked" }));

  it("all confirmed -> none", () =>
    expect(computeHeaderCta({ ...base, confirmedCount: 6 })).toEqual({ kind: "none", label: "" }));

  it("unconfigured slots -> none", () =>
    expect(computeHeaderCta({ ...base, totalSlots: null })).toEqual({ kind: "none", label: "" }));

  // Cast-aware label (C3.4): openTier branch names the cast when the next tier
  // maps to exactly one (owner's RELABEL rule). Every other branch is unaffected.
  describe("cast-aware label (nextTierCastName)", () => {
    it("openTier branch names the cast when nextTierCastName is supplied", () =>
      expect(computeHeaderCta({ ...base, nextTierCastName: "Cast B" }))
        .toEqual({ kind: "openTier", label: "Ask Cast B" }));

    it("openTier branch falls back to the tier noun when nextTierCastName is omitted", () =>
      expect(computeHeaderCta({ ...base })).toEqual({ kind: "openTier", label: "Open round 2" }));

    it("openTier branch falls back to the tier noun when nextTierCastName is null", () =>
      expect(computeHeaderCta({ ...base, nextTierCastName: null }))
        .toEqual({ kind: "openTier", label: "Open round 2" }));

    it("does not affect the confirm branch even when nextTierCastName is supplied", () =>
      expect(computeHeaderCta({ ...base, acceptedCount: 2, nextTierCastName: "Cast B" }))
        .toEqual({ kind: "confirm", label: "Book 2 who said yes" }));

    it("does not affect the reviewOffers branch (current tier still open) even when nextTierCastName is supplied", () =>
      expect(computeHeaderCta({ ...base, currentTierOpen: true, nextTierCastName: "Cast B" }))
        .toEqual({ kind: "reviewOffers", label: "Review who's been asked" }));
  });
});
