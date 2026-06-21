import { describe, it, expect } from "vitest";
import {
  deriveBookingGroups, computeInheritedCastIds, bookingStatusUpdate,
  buildOfferTierOptions, offerResultToast, offerConfirmCopy,
  pendingOfferCount, closeConfirmCopy, closeResultToast,
} from "./bookings";

type B = { artist_id: string; status: string; is_understudy: boolean };
const b = (o: Partial<B>): B => ({ artist_id: "a1", status: "suggested", is_understudy: false, ...o });

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

describe("bookingStatusUpdate", () => {
  const now = new Date("2026-06-01T10:00:00.000Z");
  it("stamps confirmed_at when confirming", () => {
    expect(bookingStatusUpdate("confirmed", now)).toEqual({
      status: "confirmed",
      confirmed_at: now.toISOString(),
    });
  });
  it("stamps cancelled_at when cancelling", () => {
    expect(bookingStatusUpdate("cancelled", now)).toEqual({
      status: "cancelled",
      cancelled_at: now.toISOString(),
    });
  });
  it("stamps no timestamp for soft_booked (characterizes current behavior — does NOT clear stale stamps)", () => {
    expect(bookingStatusUpdate("soft_booked", now)).toEqual({ status: "soft_booked" });
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
    const c = offerConfirmCopy({ tier: 1, dateLabel: "10 Jul 2026", alreadyOpened: false });
    expect(c.title).toBe("Open tier 1 offers?");
    expect(c.body).toContain("10 Jul 2026");
    expect(c.body).not.toContain("already been opened");
  });
  it("already-opened body adds the additive re-open note", () => {
    const c = offerConfirmCopy({ tier: 2, dateLabel: "10 Jul 2026", alreadyOpened: true });
    expect(c.body).toContain("Tier 2 has already been opened");
  });
  it("uses ad-hoc wording for tier 99", () => {
    const c = offerConfirmCopy({ tier: 99, dateLabel: "10 Jul 2026", alreadyOpened: true });
    expect(c.title).toBe("Open ad-hoc casts offers?");
    expect(c.body).toContain("Ad-hoc casts have already been opened");
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
