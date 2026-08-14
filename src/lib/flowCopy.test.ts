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
      title: "My Offers",
      subtitle: "View your offers and block dates you're unavailable for.",
    });
  });
  it("direct orgs get dates framing", () => {
    expect(availabilityPageCopy(direct, t)).toEqual({
      title: "My Dates",
      subtitle: "Your bookings and availability. Block dates you can't perform.",
    });
  });
});

describe("bookingStatusLabels", () => {
  it("direct orgs never claim offers", () => {
    const labels = bookingStatusLabels(direct, t);
    expect(labels.unanswered).toBe("Not booked");
    expect(labels.confirmed).toBe("Booked");
  });
  it("offer orgs keep existing labels", () => {
    const labels = bookingStatusLabels(classic, t);
    expect(labels).toMatchObject({
      suggested: "Offer pending", soft_booked: "Hold placed",
      confirmed: "Confirmed", unanswered: "No offer yet",
    });
  });
});

describe("bookingsViewCopy", () => {
  it("subtitle adapts per mode", () => {
    expect(bookingsViewCopy(classic, t).subtitle).toBe("Dates you've been offered for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct, t).subtitle).toBe("Dates you're booked for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct, t).title).toBe("My Bookings");
  });
});

describe("artistMeter", () => {
  it("offer orgs keep response rate counting confirmed + soft_booked", () => {
    const m = artistMeter(classic, t);
    expect(m.title).toBe("Response rate");
    expect(m.headerSentence).toBe("Your response rate on dates you've been offered.");
    expect(m.footer).toBe("Click to see pending offers →");
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
      "Counts dates you accepted or were booked for, out of dates you were offered. It is just for you, no one is scored on it.",
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
    expect(deliveryHint(fasttrack, t)).toBe("Offers email artists immediately when a tier opens.");
    expect(deliveryHint(classic, t)).toBe("");
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
