import { describe, expect, it } from "vitest";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "./bookingFlow";
import { computeFunnel, computeUpNext, tierFillCounts } from "./bookingCockpit";

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

describe("computeFunnel", () => {
  it("counts offered, accepted, and confirmed by group", () => {
    const funnel = computeFunnel([
      { status: "suggested", is_understudy: false },
      { status: "soft_booked", is_understudy: false },
      { status: "confirmed", is_understudy: false },
      { status: "confirmed", is_understudy: true },
      { status: "cancelled", is_understudy: false },
    ]);
    expect(funnel).toEqual({ offered: 4, accepted: 3, confirmedMain: 1, confirmedUnderstudy: 1 });
  });
});

describe("computeUpNext", () => {
  it("classic with pending offers shows digest and expiry pills", () => {
    const items = computeUpNext({
      flow: BOOKING_FLOW_DEFAULTS, times: TIMES, pendingCount: 3,
      nextExpiry: "2026-07-15T19:00:00Z", hasOpenTier: true,
    });
    const texts = items.map((i) => i.text).join("\n");
    expect(texts).toContain("19:00");
    expect(texts).toContain("3 offers expire");
    expect(texts).toContain("Auto-escalate: off");
  });
  it("shows the Berlin-local day when an expiry crosses midnight in UTC", () => {
    // 23:30 UTC on Jul 15 is already 01:30 on Jul 16 in Berlin (CEST, UTC+2),
    // and the booking engine is Berlin-anchored: the pill must say Jul 16.
    const items = computeUpNext({
      flow: BOOKING_FLOW_DEFAULTS, times: TIMES, pendingCount: 1,
      nextExpiry: "2026-07-15T23:30:00Z", hasOpenTier: false,
    });
    const expiry = items.find((i) => i.text.includes("offer expires"));
    expect(expiry?.text).toContain("16/07/2026");
  });
  it("direct mode shows the single direct-booking pill", () => {
    const items = computeUpNext({
      flow: applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), times: TIMES,
      pendingCount: 0, nextExpiry: null, hasOpenTier: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain("eligibility list");
  });
  it("emits no em- or en-dashes", () => {
    for (const i of computeUpNext({ flow: BOOKING_FLOW_DEFAULTS, times: TIMES, pendingCount: 1, nextExpiry: null, hasOpenTier: true })) {
      expect(i.text).not.toMatch(/[—–]/);
    }
  });
});

describe("tierFillCounts", () => {
  it("counts pending and accepted for one tier", () => {
    const counts = tierFillCounts([
      { status: "suggested", offer_tier: 1 },
      { status: "soft_booked", offer_tier: 1 },
      { status: "confirmed", offer_tier: 2 },
      { status: "cancelled", offer_tier: 1 },
    ], 1);
    expect(counts).toEqual({ pending: 1, accepted: 1 });
  });
});
