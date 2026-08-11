import { describe, it, expect } from "vitest";
import {
  deriveBookingGroups, computeInheritedCastIds,
  buildOfferTierOptions, offerResultToast, offerConfirmCopy,
  pendingOfferCount, closeConfirmCopy, closeResultToast,
  bookingStatusBadgeClass, bookingStatusDisplayLabel, shouldAutoOpenTier1, deriveDirectBookList,
} from "./bookings";

type B = { artist_id: string; status: string; is_understudy: boolean };
const b = (o: Partial<B>): B => ({ artist_id: "a1", status: "suggested", is_understudy: false, ...o });

describe("bookingStatusDisplayLabel", () => {
  it("maps known statuses to producer-facing labels", () => {
    expect(bookingStatusDisplayLabel("suggested")).toBe("Offered");
    expect(bookingStatusDisplayLabel("soft_booked")).toBe("Soft-booked");
    expect(bookingStatusDisplayLabel("confirmed")).toBe("Confirmed");
    expect(bookingStatusDisplayLabel("cancelled")).toBe("Cancelled");
  });

  it("humanizes an unknown status instead of surfacing the raw token", () => {
    expect(bookingStatusDisplayLabel("some_new_state")).toBe("Some new state");
  });
});

describe("deriveBookingGroups", () => {
  it("excludes cancelled bookings from every group", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "confirmed" }),
      b({ artist_id: "a2", status: "cancelled" }),
    ]);
    expect(groups.active).toHaveLength(1);
    expect(groups.bookedArtistIds.has("a2")).toBe(false);
  });

  it("splits main vs understudy", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", is_understudy: false }),
      b({ artist_id: "a2", is_understudy: true }),
    ]);
    expect(groups.main.map((x) => x.artist_id)).toEqual(["a1"]);
    expect(groups.understudy.map((x) => x.artist_id)).toEqual(["a2"]);
  });

  it("counts confirmed main and understudy separately", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "confirmed", is_understudy: false }),
      b({ artist_id: "a2", status: "soft_booked", is_understudy: false }),
      b({ artist_id: "a3", status: "confirmed", is_understudy: true }),
      b({ artist_id: "a4", status: "cancelled", is_understudy: false }),
    ]);
    expect(groups.confirmedMainCount).toBe(1);
    expect(groups.confirmedUnderstudyCount).toBe(1);
  });

  it("handles null/undefined input", () => {
    expect(deriveBookingGroups(null).active).toEqual([]);
    expect(deriveBookingGroups(undefined).bookedArtistIds.size).toBe(0);
  });

  it("dedupes artist ids that appear in multiple active bookings", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "soft_booked" }),
      b({ artist_id: "a1", status: "confirmed" }),
    ]);
    expect(groups.bookedArtistIds.size).toBe(1);
    expect(groups.bookedArtistIds.has("a1")).toBe(true);
  });

  it("excludes cancelled rows from the main and understudy arrays directly", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "cancelled", is_understudy: false }),
      b({ artist_id: "a2", status: "cancelled", is_understudy: true }),
    ]);
    expect(groups.main).toHaveLength(0);
    expect(groups.understudy).toHaveLength(0);
  });
});

describe("computeInheritedCastIds", () => {
  it("returns eligibility ids minus overrides", () => {
    const result = computeInheritedCastIds(["c1", "c2", "c3"], new Set(["c2"]));
    expect([...result].sort()).toEqual(["c1", "c3"]);
  });
  it("handles null eligibility", () => {
    expect(computeInheritedCastIds(null, new Set(["c1"])).size).toBe(0);
  });
});

describe("buildOfferTierOptions", () => {
  it("dedupes, sorts ascending, and labels tiers", () => {
    expect(buildOfferTierOptions({ priorities: [2, 1, 2], hasAdHoc: false })).toEqual([
      { value: 1, label: "Tier 1" },
      { value: 2, label: "Tier 2" },
    ]);
  });
  it("drops priorities below 1 and any stray 99, then appends Ad-hoc when present", () => {
    expect(buildOfferTierOptions({ priorities: [0, 1, 99], hasAdHoc: true })).toEqual([
      { value: 1, label: "Tier 1" },
      { value: 99, label: "Ad-hoc casts" },
    ]);
  });
  it("returns empty when no priorities and no ad-hoc", () => {
    expect(buildOfferTierOptions({ priorities: [], hasAdHoc: false })).toEqual([]);
  });
});

describe("offerResultToast", () => {
  it("success with pluralized count when offers created", () => {
    expect(offerResultToast({ offersCreated: 2 }, 1)).toEqual({ kind: "success", text: "Opened tier 1 — 2 offers created" });
    expect(offerResultToast({ offersCreated: 1 }, 1)).toEqual({ kind: "success", text: "Opened tier 1 — 1 offer created" });
  });
  it("info with backend message when nothing created", () => {
    expect(offerResultToast({ offersCreated: 0, message: "No casts at tier 2 for this city" }, 2))
      .toEqual({ kind: "info", text: "No casts at tier 2 for this city" });
  });
  it("info with fallback when no message", () => {
    expect(offerResultToast({ offersCreated: 0 }, 99)).toEqual({ kind: "info", text: "No new offers created" });
  });
});

describe("offerConfirmCopy", () => {
  it("first-open body has no re-open note", () => {
    const c = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "digest" });
    expect(c.title).toBe("Open tier 1 offers?");
    expect(c.body).toContain("10 Jul 2026");
    expect(c.body).not.toContain("already been opened");
  });
  it("already-opened body adds the additive re-open note", () => {
    const c = offerConfirmCopy({ tier: 2, dateLabel: "10 Jul 2026", alreadyOpened: true, offerDelivery: "digest" });
    expect(c.body).toContain("Tier 2 has already been opened");
  });
  it("uses ad-hoc wording for tier 99", () => {
    const c = offerConfirmCopy({ tier: 99, dateLabel: "10 Jul 2026", alreadyOpened: true, offerDelivery: "digest" });
    expect(c.title).toBe("Open ad-hoc casts offers?");
    expect(c.body).toContain("Ad-hoc casts have already been opened");
  });
  it("digest delivery mentions the daily offer digest", () => {
    const c = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "digest" });
    expect(c.body).toContain("next daily offer digest");
  });
  // Regression: immediate-delivery orgs saw "next daily offer digest" copy even
  // though offers for those orgs are emailed the moment the tier opens.
  it("immediate delivery mentions emails go out the moment the tier opens", () => {
    const c = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "immediate" });
    expect(c.body).toContain("emailed the moment the tier opens");
    expect(c.body).not.toContain("daily offer digest");
  });
  // Regression: a producer scoping an open to a skill filter got no confirm-dialog cue,
  // so re-opening a different tier silently under-offered with a stale filter.
  it("appends the skill-filter cue when skillFilterNames is non-empty", () => {
    const c = offerConfirmCopy({
      tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "digest",
      skillFilterNames: ["judge", "aerial"],
    });
    expect(c.body.endsWith("Only artists with all of these skills receive offers: judge, aerial.")).toBe(true);
  });
  it("omits the skill-filter cue when skillFilterNames is empty or absent", () => {
    const withoutField = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "digest" });
    const withEmptyArray = offerConfirmCopy({
      tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "digest", skillFilterNames: [],
    });
    expect(withoutField.body).not.toContain("receive offers");
    expect(withEmptyArray.body).toEqual(withoutField.body);
  });

  // Cast-aware path (C3.4): when the sheet resolves the next offer target to a
  // single cast, the confirm copy names it instead of the bare tier noun.
  describe("cast-aware (castName present)", () => {
    const castArgs = {
      tier: 2, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "immediate" as const,
      castName: "Cast B", matchCount: 7, castTotal: 9, requiredSkillNames: ["Vocals"],
    };

    it("titles the dialog with the cast name", () => {
      const c = offerConfirmCopy(castArgs);
      expect(c.title).toBe("Open offers to Cast B?");
    });

    it("body states the match count against the cast total, for the date", () => {
      const c = offerConfirmCopy(castArgs);
      expect(c.body).toContain("7 of the 9 artists in Cast B get an offer for 10 Jul 2026.");
    });

    it("body states the required skills all matched artists have", () => {
      const c = offerConfirmCopy(castArgs);
      expect(c.body).toContain("All 7 have the skills this date requires: Vocals.");
    });

    it("immediate delivery mentions emails go out the moment the tier opens", () => {
      const c = offerConfirmCopy(castArgs);
      expect(c.body).toContain("Offers are emailed the moment the tier opens, and you can cancel any offer afterward.");
    });

    it("digest delivery swaps the delivery sentence", () => {
      const c = offerConfirmCopy({ ...castArgs, offerDelivery: "digest" });
      expect(c.body).toContain("They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.");
      expect(c.body).not.toContain("emailed the moment the tier opens");
    });

    it("drops the skills sentence entirely when requiredSkillNames is empty", () => {
      const c = offerConfirmCopy({ ...castArgs, requiredSkillNames: [] });
      expect(c.body).not.toContain("have the skills this date requires");
    });

    it("keeps the existing tier-phrased re-open note when alreadyOpened", () => {
      const c = offerConfirmCopy({ ...castArgs, alreadyOpened: true });
      expect(c.body).toContain("Tier 2 has already been opened");
    });

    it("appends a capped, friendly-reason Not offered line when excludedDetail is non-empty", () => {
      const c = offerConfirmCopy({
        ...castArgs,
        excludedDetail: [
          { id: "1", name: "Ana Ruiz", reason: "missing_skills" },
          { id: "2", name: "Tom Vale", reason: "blocked" },
        ],
      });
      expect(c.body.endsWith("Not offered: Ana Ruiz (missing a required skill) · Tom Vale (blocked on this date).")).toBe(true);
    });

    it("caps the Not offered line at 5 named entries, summarizing the rest", () => {
      const c = offerConfirmCopy({
        ...castArgs,
        excludedDetail: [
          { id: "1", name: "A", reason: "missing_skills" },
          { id: "2", name: "B", reason: "blocked" },
          { id: "3", name: "C", reason: "already_booked" },
          { id: "4", name: "D", reason: "inactive" },
          { id: "5", name: "E", reason: "not_eligible" },
          { id: "6", name: "F", reason: "missing_skills" },
          { id: "7", name: "G", reason: "missing_skills" },
        ],
      });
      expect(c.body).toContain("A (missing a required skill) · B (blocked on this date) · C (already booked) · D (inactive) · E (not eligible) · and 2 more");
    });

    it("omits the Not offered line when excludedDetail is absent or empty", () => {
      const absent = offerConfirmCopy(castArgs);
      const empty = offerConfirmCopy({ ...castArgs, excludedDetail: [] });
      expect(absent.body).not.toContain("Not offered");
      expect(empty.body).not.toContain("Not offered");
    });
  });

  // Backward compatibility: the multi-cast/ad-hoc/tier-fallback path (no castName)
  // must render byte-for-byte the same copy as before this task.
  describe("unchanged when castName is absent (regression pin)", () => {
    it("first-open, digest, no skill filter", () => {
      const c = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false, offerDelivery: "digest" });
      expect(c).toEqual({
        title: "Open tier 1 offers?",
        body:
          "This creates suggested bookings for all eligible artists in tier 1 for 10 Jul 2026. " +
          "They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.",
      });
    });

    it("already-opened, immediate, with a skill filter", () => {
      const c = offerConfirmCopy({
        tier: 2, dateLabel: "10 Jul 2026", alreadyOpened: true, offerDelivery: "immediate",
        skillFilterNames: ["judge", "aerial"],
      });
      expect(c).toEqual({
        title: "Open tier 2 offers?",
        body:
          "This creates suggested bookings for all eligible artists in tier 2 for 10 Jul 2026. " +
          "Offers are emailed the moment the tier opens, and you can cancel any offer afterward. " +
          "Tier 2 has already been opened — re-opening only adds offers for artists who don't have one yet." +
          " Only artists with all of these skills receive offers: judge, aerial.",
      });
    });

    it("ad-hoc tier 99", () => {
      const c = offerConfirmCopy({ tier: 99, dateLabel: "10 Jul 2026", alreadyOpened: true, offerDelivery: "digest" });
      expect(c).toEqual({
        title: "Open ad-hoc casts offers?",
        body:
          "This creates suggested bookings for all eligible artists in ad-hoc casts for 10 Jul 2026. " +
          "They'll be emailed in the next daily offer digest, and you can cancel any offer afterward. " +
          "Ad-hoc casts have already been opened — re-opening only adds offers for artists who don't have one yet.",
      });
    });
  });
});

describe("pendingOfferCount", () => {
  it("counts only suggested bookings for the given tier", () => {
    const rows = [
      { status: "suggested", offer_tier: 1 },
      { status: "suggested", offer_tier: 1 },
      { status: "soft_booked", offer_tier: 1 },
      { status: "suggested", offer_tier: 2 },
    ];
    expect(pendingOfferCount(rows, 1)).toBe(2);
    expect(pendingOfferCount(rows, 2)).toBe(1);
    expect(pendingOfferCount(rows, 3)).toBe(0);
  });
});

describe("closeConfirmCopy", () => {
  it("withdraw caption names the pending count; both options explained", () => {
    const c = closeConfirmCopy({ tier: 1, pendingCount: 3 });
    expect(c.title).toBe("Close tier 1?");
    expect(c.intro).toContain("stops the reminder");
    expect(c.withdraw.caption).toContain("3 offers");
    expect(c.keep.caption).toContain("3 unanswered offers");
  });
  it("zero pending uses the empty-count phrasing", () => {
    const c = closeConfirmCopy({ tier: 2, pendingCount: 0 });
    expect(c.withdraw.caption).toContain("No unanswered offers");
    expect(c.keep.caption).toContain("just stops the alerts");
  });
  it("singularizes a single pending offer", () => {
    const c = closeConfirmCopy({ tier: 1, pendingCount: 1 });
    // trailing space is intentional: the caption reads "1 offer no-one…" (singular, no "s")
    expect(c.withdraw.caption).toContain("1 offer ");
  });
});

describe("closeResultToast", () => {
  it("info when nothing happened", () => {
    expect(closeResultToast({ closed: false, withdrawn: 0 }, 1)).toEqual({ kind: "info", text: "Tier was not open" });
  });
  it("success naming withdrawn count", () => {
    expect(closeResultToast({ closed: true, withdrawn: 2 }, 1)).toEqual({ kind: "success", text: "Closed tier 1 — withdrew 2 offers" });
  });
  it("success without count when closed but nothing withdrawn", () => {
    expect(closeResultToast({ closed: true, withdrawn: 0 }, 99)).toEqual({ kind: "success", text: "Closed ad-hoc casts" });
  });
  it("reports a withdraw against an already-closed tier without claiming a fresh close", () => {
    expect(closeResultToast({ closed: false, withdrawn: 2 }, 1)).toEqual({ kind: "success", text: "Withdrew 2 offers from tier 1" });
  });
});

describe("bookingStatusBadgeClass", () => {
  it("maps each known status to its semantic-token classes", () => {
    expect(bookingStatusBadgeClass("confirmed")).toBe("bg-success/10 text-success");
    expect(bookingStatusBadgeClass("soft_booked")).toBe("bg-warning/10 text-warning");
    expect(bookingStatusBadgeClass("suggested")).toBe("bg-info/10 text-info");
    expect(bookingStatusBadgeClass("cancelled")).toBe("bg-destructive/10 text-destructive");
  });
  it("maps the synthetic artist-only `unanswered` status", () => {
    expect(bookingStatusBadgeClass("unanswered")).toBe("bg-muted text-muted-foreground");
  });
  it("reconciled the prior drift: `suggested` is the info variant everywhere", () => {
    // Previously `bg-muted text-muted-foreground` in BookingRow only.
    expect(bookingStatusBadgeClass("suggested")).toBe("bg-info/10 text-info");
  });
  it("returns an empty string for an unknown status (badge falls back to its variant)", () => {
    expect(bookingStatusBadgeClass("nonsense")).toBe("");
    expect(bookingStatusBadgeClass("")).toBe("");
  });
});

describe("shouldAutoOpenTier1", () => {
  const flow = { auto_open_tier1: true, artist_acceptance: true };
  it("true when enabled, session present, tier 1 not yet opened", () => {
    expect(shouldAutoOpenTier1({ flow, hasSession: true, openedTiers: [] })).toBe(true);
  });
  it("false without a session, when disabled, in direct mode, or when tier 1 exists", () => {
    expect(shouldAutoOpenTier1({ flow, hasSession: false, openedTiers: [] })).toBe(false);
    expect(shouldAutoOpenTier1({ flow: { ...flow, auto_open_tier1: false }, hasSession: true, openedTiers: [] })).toBe(false);
    expect(shouldAutoOpenTier1({ flow: { ...flow, artist_acceptance: false }, hasSession: true, openedTiers: [] })).toBe(false);
    expect(shouldAutoOpenTier1({ flow, hasSession: true, openedTiers: [{ tier: 1 }] })).toBe(false);
  });
});

describe("deriveDirectBookList", () => {
  const artists = [
    { id: "a1", name: "One" },
    { id: "a2", name: "Two" },
    { id: "a3", name: "Three" },
  ];
  it("fails closed while eligibility has not resolved", () => {
    expect(deriveDirectBookList(artists, undefined, new Set(), null)).toEqual([]);
  });
  it("fails closed while the blocked set has not resolved", () => {
    expect(deriveDirectBookList(artists, { artistIds: null }, undefined, null)).toEqual([]);
  });
  it("null artistIds means no eligibility restriction", () => {
    expect(deriveDirectBookList(artists, { artistIds: null }, new Set(), null)).toEqual(artists);
  });
  it("filters to the eligible set", () => {
    expect(deriveDirectBookList(artists, { artistIds: new Set(["a2"]) }, new Set(), null)).toEqual([
      { id: "a2", name: "Two" },
    ]);
  });
  it("excludes artists with a blocked date, matching the tiered offer path", () => {
    expect(deriveDirectBookList(artists, { artistIds: null }, new Set(["a1", "a3"]), null)).toEqual([
      { id: "a2", name: "Two" },
    ]);
  });
  it("applies eligibility and blocked filters together", () => {
    expect(
      deriveDirectBookList(artists, { artistIds: new Set(["a1", "a2"]) }, new Set(["a1"]), null),
    ).toEqual([{ id: "a2", name: "Two" }]);
  });
  it("returns [] when org artists have not loaded", () => {
    expect(deriveDirectBookList(undefined, { artistIds: null }, new Set(), null)).toEqual([]);
  });
  it("fails closed while the skill-eligibility set is unresolved", () => {
    expect(deriveDirectBookList(
      [{ id: "a1", name: "A" }], { artistIds: null }, new Set(), undefined,
    )).toEqual([]);
  });
  it("null skill set means no skill restriction", () => {
    expect(deriveDirectBookList(
      [{ id: "a1", name: "A" }], { artistIds: null }, new Set(), null,
    )).toEqual([{ id: "a1", name: "A" }]);
  });
  it("filters to artists in the skill-eligible set", () => {
    expect(deriveDirectBookList(
      [{ id: "a1", name: "A" }, { id: "a2", name: "B" }],
      { artistIds: null }, new Set(), new Set(["a2"]),
    )).toEqual([{ id: "a2", name: "B" }]);
  });

  // EligibilityBookList's narrowing-chip counts (design 1h) need each listed artist's
  // skillIds. deriveDirectBookList is generic precisely so it passes extra artist fields
  // (like skillIds from fetchActiveArtistOptions) straight through, not just {id,name}.
  it("passes through extra artist fields (e.g. skillIds) unchanged", () => {
    const withSkills = [
      { id: "a1", name: "A", skillIds: ["s1"] },
      { id: "a2", name: "B", skillIds: [] },
    ];
    expect(
      deriveDirectBookList(withSkills, { artistIds: null }, new Set(), null),
    ).toEqual(withSkills);
  });
});
