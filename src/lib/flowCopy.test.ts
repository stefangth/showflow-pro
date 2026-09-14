import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "./bookingFlow";
import {
  artistMeter, availabilityPageCopy, bookingStatusLabels, bookingsViewCopy, deliveryHint,
} from "./flowCopy";

// Copy is now sourced from the `flowCopy` i18n namespace; bind an English `t`
// so the assertions below pin the canonical (byte-identical) English output.
const t = i18n.getFixedT("en", "flowCopy");

const classic = BOOKING_FLOW_DEFAULTS;
const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
const fasttrack = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");

describe("availabilityPageCopy", () => {
  it("offer orgs keep the offers framing", () => {
    expect(availabilityPageCopy(classic, t)).toEqual({
      title: "My Asks",
      subtitle: "See what you've been asked and mark dates you're not free for.",
    });
  });
  it("direct orgs get dates framing", () => {
    expect(availabilityPageCopy(direct, t)).toEqual({
      title: "My Dates",
      subtitle: "Your bookings and availability. Mark dates you're not free.",
    });
  });
});

describe("bookingStatusLabels", () => {
  it("direct orgs never claim offers", () => {
    const labels = bookingStatusLabels(direct, t);
    expect(labels.unanswered).toBe("Not asked yet");
    expect(labels.confirmed).toBe("Booked");
  });
  it("offer orgs keep existing labels", () => {
    const labels = bookingStatusLabels(classic, t);
    expect(labels).toMatchObject({
      suggested: "Asked", soft_booked: "Said yes · waiting on your Production Team",
      confirmed: "Booked", unanswered: "Not asked yet",
    });
  });
  // These labels render on the ARTIST's own surfaces (My Asks, My Dates), so a
  // said-yes date must never tell the artist it is waiting on them: in Classic the
  // to-do is the production team's.
  it("never points a said-yes date back at the artist", () => {
    for (const flow of [classic, direct, fasttrack]) {
      expect(bookingStatusLabels(flow, t).soft_booked).not.toMatch(/waiting on you(?!r)/i);
    }
  });
  it("drops the waiting clause where the org does not keep the last word", () => {
    expect(bookingStatusLabels(fasttrack, t).soft_booked).toBe("Said yes");
  });
});

describe("bookingsViewCopy", () => {
  it("subtitle adapts per mode", () => {
    expect(bookingsViewCopy(classic, t).subtitle).toBe("Dates you've been asked about, based on your cast eligibility.");
    expect(bookingsViewCopy(direct, t).subtitle).toBe("Dates you're booked for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct, t).title).toBe("My Bookings");
  });
});

describe("artistMeter", () => {
  it("offer orgs keep response rate counting confirmed + soft_booked", () => {
    const m = artistMeter(classic, t);
    expect(m.title).toBe("Answer rate");
    expect(m.headerSentence).toBe("Your answer rate on dates you've been asked about.");
    expect(m.footer).toBe("Click to see your open asks →");
    expect(m.filterUnanswered).toBe(true);
    expect(m.countStatuses).toEqual(["confirmed", "soft_booked"]);
  });
  it("direct orgs get booked dates counting confirmed only", () => {
    const m = artistMeter(direct, t);
    expect(m.title).toBe("Booked dates");
    expect(m.headerSentence).toBe("Your booked share of the dates you're eligible for.");
    expect(m.footer).toBe("Click to see your dates →");
    expect(m.filterUnanswered).toBe(false);
    expect(m.countStatuses).toEqual(["confirmed"]);
  });

  it("offer meter explains what counts and that no one is scored", () => {
    expect(artistMeter({ artist_acceptance: true } as BookingFlow, t).explainer).toBe(
      "Counts dates you said yes to or were booked for, out of dates you were asked about. It is just for you, no one is scored on it.",
    );
  });

  it("direct-book meter explains the booked/eligible ratio", () => {
    expect(artistMeter({ artist_acceptance: false } as BookingFlow, t).explainer).toBe(
      "Dates you are booked for, out of dates you are eligible for.",
    );
  });
});

describe("deliveryHint", () => {
  it("only immediate offer orgs get the hint", () => {
    // No shipped preset sets offer_delivery: "immediate" anymore (autopilot/fasttrack
    // switched to digest), but the field is still a valid custom flow value, so the hint
    // itself must keep working for an org configured that way by hand.
    const immediateFlow = { ...classic, offer_delivery: "immediate" as const };
    expect(deliveryHint(immediateFlow, t)).toBe("Artists get asked by email as soon as a tier opens.");
    expect(deliveryHint(classic, t)).toBe("");
    expect(deliveryHint(fasttrack, t)).toBe("");
    expect(deliveryHint(direct, t)).toBe("");
  });
});

describe("copy hygiene", () => {
  it("emits no em- or en-dashes in any mode", () => {
    for (const flow of [classic, direct, fasttrack]) {
      const strings = [
        ...Object.values(availabilityPageCopy(flow, t)),
        ...Object.values(bookingsViewCopy(flow, t)),
        ...Object.values(bookingStatusLabels(flow, t)),
        artistMeter(flow, t).title, artistMeter(flow, t).headerSentence, artistMeter(flow, t).footer,
        artistMeter(flow, t).explainer,
        deliveryHint(flow, t),
      ];
      for (const s of strings) expect(s).not.toMatch(/[—–]/);
    }
  });
});
