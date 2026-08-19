import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import {
  confirmConsequenceNote, cancelBookingCopy, unrestrictedEligibilityNote,
  acceptConsequenceNote,
  softBookedMeaning, tierConceptNote, dateSourceNote,
} from "./actionCopy";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";

// Copy is now sourced from the `bookingCopy` i18n namespace; bind an English `t`
// so these assertions pin the canonical (byte-identical) English output.
const t = i18n.getFixedT("en", "bookingCopy");
const SOFT_BOOKED_MEANING = softBookedMeaning(t);
const TIER_CONCEPT_NOTE = tierConceptNote(t);
const DATE_SOURCE_NOTE = dateSourceNote(t);

// Built from the shipped presets, the way coverageCopy/timingCopy's tests are, so the flow
// these functions read is a real one rather than a hand-written partial that could drift
// from what the app actually ships.
const classic = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
const off = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
const digestOff = { ...classic, confirmation_digest: false };

describe("confirmConsequenceNote", () => {
  it("states the app-and-digest consequence when the flow is active with the confirmation digest on", () => {
    expect(confirmConsequenceNote(classic, 19, true, t)).toBe(
      "Book gives them the place. The artist sees it in the app right away. The booking email goes out in the daily send at 19:00h (Berlin, Germany).",
    );
  });

  it("zero-pads a single-digit hour the same way scheduleChangeNote does", () => {
    expect(confirmConsequenceNote(classic, 7, true, t)).toBe(
      "Book gives them the place. The artist sees it in the app right away. The booking email goes out in the daily send at 07:00h (Berlin, Germany).",
    );
  });

  it("drops the email clause when the confirmation digest is off", () => {
    expect(confirmConsequenceNote(digestOff, 19, true, t)).toBe(
      "Book gives them the place and notifies the artist in the app right away.",
    );
  });

  it("states only the bare consequence when the flow is paused", () => {
    expect(confirmConsequenceNote(off, 19, true, t)).toBe("Book gives them the place.");
    expect(off.active).toBe(false);
  });

  it("states only the bare consequence when the flow is unread", () => {
    expect(confirmConsequenceNote(null, 19, true, t)).toBe("Book gives them the place.");
    expect(confirmConsequenceNote(undefined, 19, true, t)).toBe("Book gives them the place.");
  });

  it("states only the bare consequence when the org has no booking_flow entitlement, even with the flow active and the confirmation digest on", () => {
    // Same bug class as cancelBookingCopy's who-hears line: a super-admin viewing an org
    // without the booking_flow entitlement must not see a promise about an email that
    // send-confirmation-digest (entitlement-gated) will never send.
    expect(confirmConsequenceNote(classic, 19, false, t)).toBe("Book gives them the place.");
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
      t,
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
      t,
    });
    expect(copy.understudyLine).toBe(
      "If Ada Lovelace is in the main cast, the understudy who has been waiting longest and said yes moves up automatically.",
    );
  });

  it("omits the understudy-promotion line when understudy promotion is disabled", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: classic,
      confirmationDigestHour: 19,
      t,
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
      t,
    });
    expect(copy.whoHearsLine).toContain("21:00h (Berlin, Germany)");
    expect(copy.whoHearsLine).toMatch(/notified in the app/);
  });

  it("falls back to a plain in-app claim when scheduleChangeNote has nothing to say (flow off)", () => {
    const copy = cancelBookingCopy({
      artistName: "Ada Lovelace",
      understudyPromotionEnabled: false,
      bookingFlowEnabled: true,
      flow: off,
      confirmationDigestHour: 19,
      t,
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
      t,
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
      t,
    });
    expect(copy.whoHearsLine).toBe("The artist is notified in the app.");
  });
});

describe("acceptConsequenceNote", () => {
  it("hold-then-confirm flow tells the artist a hold is placed", () => {
    expect(acceptConsequenceNote({ producer_confirmation: true }, t)).toEqual({
      title: "Said yes",
      description: "You said yes. Your producer has the last word next.",
    });
  });

  it("auto-confirm flow tells the artist they are booked", () => {
    expect(acceptConsequenceNote({ producer_confirmation: false }, t)).toEqual({
      title: "Said yes. You're booked.",
    });
  });

  it("defaults to hold-then-confirm when the flow is unknown", () => {
    expect(acceptConsequenceNote(null, t).description).toBe("You said yes. Your producer has the last word next.");
    expect(acceptConsequenceNote(undefined, t).description).toBe("You said yes. Your producer has the last word next.");
  });
});

describe("unrestrictedEligibilityNote", () => {
  it("names the org in the unrestricted-eligibility note", () => {
    expect(unrestrictedEligibilityNote("Cirque Lumiere", t)).toBe(
      "This date has no cast limits, so anyone in Cirque Lumiere can be booked here.",
    );
  });
});

describe("fixed copy constants", () => {
  it("state the shipped strings exactly", () => {
    expect(SOFT_BOOKED_MEANING).toBe("Said yes, waiting on you. Not booked until you book it.");
    expect(TIER_CONCEPT_NOTE).toBe(
      "Casts are asked in priority order. Asking starts with the first round. If it can't fill the date, you open the next round.",
    );
    expect(DATE_SOURCE_NOTE).toBe(
      "You can add a date by hand here. If your workspace syncs from Airtable, those dates keep updating on their own, and a date you add here is not changed by a sync.",
    );
  });
});

it("uses no em or en dashes in any branch or constant", () => {
  const flows = [classic, off, digestOff, null, undefined];
  for (const flow of flows) {
    for (const hour of [7, 19, 21]) {
      for (const bookingFlowEnabled of [true, false]) {
        expect(confirmConsequenceNote(flow, hour, bookingFlowEnabled, t)).not.toMatch(/[—–]/);
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
      t,
        });
        expect(copy.title).not.toMatch(/[—–]/);
        if (copy.understudyLine) expect(copy.understudyLine).not.toMatch(/[—–]/);
        expect(copy.whoHearsLine).not.toMatch(/[—–]/);
      }
    }
  }
  expect(unrestrictedEligibilityNote("Cirque Lumiere", t)).not.toMatch(/[—–]/);
  expect(SOFT_BOOKED_MEANING).not.toMatch(/[—–]/);
  expect(TIER_CONCEPT_NOTE).not.toMatch(/[—–]/);
  expect(DATE_SOURCE_NOTE).not.toMatch(/[—–]/);
  for (const flow of [{ producer_confirmation: true }, { producer_confirmation: false }, null, undefined]) {
    const note = acceptConsequenceNote(flow, t);
    expect(note.title).not.toMatch(/[—–]/);
    if (note.description) expect(note.description).not.toMatch(/[—–]/);
  }
});
