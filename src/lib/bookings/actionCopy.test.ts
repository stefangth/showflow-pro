import { describe, it, expect } from "vitest";
import {
  confirmConsequenceNote, cancelBookingCopy, unrestrictedEligibilityNote,
  SOFT_BOOKED_MEANING, TIER_CONCEPT_NOTE, DATE_SOURCE_NOTE,
} from "./actionCopy";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";

// Built from the shipped presets, the way coverageCopy/timingCopy's tests are, so the flow
// these functions read is a real one rather than a hand-written partial that could drift
// from what the app actually ships.
const classic = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
const off = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
const digestOff = { ...classic, confirmation_digest: false };

describe("confirmConsequenceNote", () => {
  it("states the app-and-digest consequence when the flow is active with the confirmation digest on", () => {
    expect(confirmConsequenceNote(classic, 19, true)).toBe(
      "Confirm places the booking. The artist sees it in the app right away. The confirmation email goes out in the daily summary at 19:00 Berlin.",
    );
  });

  it("zero-pads a single-digit hour the same way scheduleChangeNote does", () => {
    expect(confirmConsequenceNote(classic, 7, true)).toBe(
      "Confirm places the booking. The artist sees it in the app right away. The confirmation email goes out in the daily summary at 07:00 Berlin.",
    );
  });

  it("drops the email clause when the confirmation digest is off", () => {
    expect(confirmConsequenceNote(digestOff, 19, true)).toBe(
      "Confirm places the booking and notifies the artist in the app right away.",
    );
  });

  it("states only the bare consequence when the flow is paused", () => {
    expect(confirmConsequenceNote(off, 19, true)).toBe("Confirm places the booking.");
    expect(off.active).toBe(false);
  });

  it("states only the bare consequence when the flow is unread", () => {
    expect(confirmConsequenceNote(null, 19, true)).toBe("Confirm places the booking.");
    expect(confirmConsequenceNote(undefined, 19, true)).toBe("Confirm places the booking.");
  });

  it("states only the bare consequence when the org has no booking_flow entitlement, even with the flow active and the confirmation digest on", () => {
    // Same bug class as cancelBookingCopy's who-hears line: a super-admin viewing an org
    // without the booking_flow entitlement must not see a promise about an email that
    // send-confirmation-digest (entitlement-gated) will never send.
    expect(confirmConsequenceNote(classic, 19, false)).toBe("Confirm places the booking.");
  });
});

describe("cancelBookingCopy", () => {
  it("names the artist in the title", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: classic,
      confirmationDigestHour: 19,
    });
    expect(copy.title).toBe("Cancel Ada Lovelace's booking?");
  });

  it("includes the understudy-promotion line when understudy promotion is enabled", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: true,
      bookingFlowEnabled: true,
      flow: classic,
      confirmationDigestHour: 19,
    });
    expect(copy.understudyLine).toBe(
      "If Ada Lovelace is in the main cast, the longest waiting accepted understudy is promoted automatically.",
    );
  });

  it("omits the understudy-promotion line when understudy promotion is disabled", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: classic,
      confirmationDigestHour: 19,
    });
    expect(copy.understudyLine).toBeNull();
  });

  it("carries scheduleChangeNote's own who-hears line when it has one", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: classic,
      confirmationDigestHour: 21,
    });
    expect(copy.whoHearsLine).toMatch(/21:00 Berlin/);
    expect(copy.whoHearsLine).toMatch(/notified in the app/);
  });

  it("falls back to a plain in-app claim when scheduleChangeNote has nothing to say (flow off)", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: off,
      confirmationDigestHour: 19,
    });
    expect(copy.whoHearsLine).toBe("The artist is notified in the app.");
  });

  it("falls back to a plain in-app claim when scheduleChangeNote has nothing to say (no flow read)", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: null,
      confirmationDigestHour: 19,
    });
    expect(copy.whoHearsLine).toBe("The artist is notified in the app.");
  });

  it("falls back to a plain in-app claim when the org has no booking_flow entitlement", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: false,
      flow: classic,
      confirmationDigestHour: 19,
    });
    expect(copy.whoHearsLine).toBe("The artist is notified in the app.");
  });
});

describe("unrestrictedEligibilityNote", () => {
  it("names the org in the unrestricted-eligibility note", () => {
    expect(unrestrictedEligibilityNote("Cirque Lumiere")).toBe(
      "This date has no cast limits, so anyone in Cirque Lumiere can be booked here.",
    );
  });
});

describe("fixed copy constants", () => {
  it("state the shipped strings exactly", () => {
    expect(SOFT_BOOKED_MEANING).toBe("Accepted the offer. Held for you, not booked, until you confirm.");
    expect(TIER_CONCEPT_NOTE).toBe(
      "Tiers are your casts in priority order. Offers open with tier 1. If it cannot fill, you open the next tier.",
    );
    expect(DATE_SOURCE_NOTE).toBe(
      "You can add a show date by hand here. If your workspace syncs from Airtable, those dates keep updating on their own, and a date you add here is not changed by a sync.",
    );
  });
});

it("uses no em or en dashes in any branch or constant", () => {
  const flows = [classic, off, digestOff, null, undefined];
  for (const flow of flows) {
    for (const hour of [7, 19, 21]) {
      for (const bookingFlowEnabled of [true, false]) {
        expect(confirmConsequenceNote(flow, hour, bookingFlowEnabled)).not.toMatch(/[—–]/);
      }
    }
  }
  for (const flow of flows) {
    for (const understudyPromotionEnabled of [true, false]) {
      for (const bookingFlowEnabled of [true, false]) {
        const copy = cancelBookingCopy({
          artistName: "Ada Lovelace",
          understudyPromotionEnabled,
          bookingFlowEnabled,
          flow,
          confirmationDigestHour: 19,
        });
        expect(copy.title).not.toMatch(/[—–]/);
        if (copy.understudyLine) expect(copy.understudyLine).not.toMatch(/[—–]/);
        expect(copy.whoHearsLine).not.toMatch(/[—–]/);
      }
    }
  }
  expect(unrestrictedEligibilityNote("Cirque Lumiere")).not.toMatch(/[—–]/);
  expect(SOFT_BOOKED_MEANING).not.toMatch(/[—–]/);
  expect(TIER_CONCEPT_NOTE).not.toMatch(/[—–]/);
  expect(DATE_SOURCE_NOTE).not.toMatch(/[—–]/);
});
