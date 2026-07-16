import { describe, expect, it } from "vitest";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "./bookingFlow";
import {
  artistMeter, availabilityPageCopy, bookingStatusLabels, bookingsViewCopy, deliveryHint,
} from "./flowCopy";

const classic = BOOKING_FLOW_DEFAULTS;
const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
const fasttrack = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");

describe("availabilityPageCopy", () => {
  it("offer orgs keep the offers framing", () => {
    expect(availabilityPageCopy(classic)).toEqual({
      title: "My Offers",
      subtitle: "View your offers and block dates you're unavailable for.",
    });
  });
  it("direct orgs get dates framing", () => {
    expect(availabilityPageCopy(direct)).toEqual({
      title: "My Dates",
      subtitle: "Your bookings and availability. Block dates you can't perform.",
    });
  });
});

describe("bookingStatusLabels", () => {
  it("direct orgs never claim offers", () => {
    const labels = bookingStatusLabels(direct);
    expect(labels.unanswered).toBe("Not booked");
    expect(labels.confirmed).toBe("Booked");
  });
  it("offer orgs keep existing labels", () => {
    const labels = bookingStatusLabels(classic);
    expect(labels).toMatchObject({
      suggested: "Offer pending", soft_booked: "Hold placed",
      confirmed: "Confirmed", unanswered: "No offer yet",
    });
  });
});

describe("bookingsViewCopy", () => {
  it("subtitle adapts per mode", () => {
    expect(bookingsViewCopy(classic).subtitle).toBe("Dates you've been offered for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct).subtitle).toBe("Dates you're booked for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct).title).toBe("My Bookings");
  });
});

describe("artistMeter", () => {
  it("offer orgs keep response rate counting confirmed + soft_booked", () => {
    const m = artistMeter(classic);
    expect(m.title).toBe("Response rate");
    expect(m.headerSentence).toBe("Your response rate on dates you've been offered.");
    expect(m.footer).toBe("Click to see pending offers →");
    expect(m.filterUnanswered).toBe(true);
    expect(m.countStatuses).toEqual(["confirmed", "soft_booked"]);
  });
  it("direct orgs get booked dates counting confirmed only", () => {
    const m = artistMeter(direct);
    expect(m.title).toBe("Booked dates");
    expect(m.headerSentence).toBe("Your booked share of the dates you're eligible for.");
    expect(m.footer).toBe("Click to see your dates →");
    expect(m.filterUnanswered).toBe(false);
    expect(m.countStatuses).toEqual(["confirmed"]);
  });
});

describe("deliveryHint", () => {
  it("only immediate offer orgs get the hint", () => {
    expect(deliveryHint(fasttrack)).toBe("Offers email artists immediately when a tier opens.");
    expect(deliveryHint(classic)).toBe("");
    expect(deliveryHint(direct)).toBe("");
  });
});

describe("copy hygiene", () => {
  it("emits no em- or en-dashes in any mode", () => {
    for (const flow of [classic, direct, fasttrack]) {
      const strings = [
        ...Object.values(availabilityPageCopy(flow)),
        ...Object.values(bookingsViewCopy(flow)),
        ...Object.values(bookingStatusLabels(flow)),
        artistMeter(flow).title, artistMeter(flow).headerSentence, artistMeter(flow).footer,
        deliveryHint(flow),
      ];
      for (const s of strings) expect(s).not.toMatch(/[—–]/);
    }
  });
});
