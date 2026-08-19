import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { buildActivity } from "./bookingCockpit";

const t = i18n.getFixedT("en", "bookingCopy");

describe("buildActivity", () => {
  it("derives confirmed-booking and tier open/close events, newest first, capped", () => {
    const items = buildActivity({ t,
      bookings: [
        { status: "confirmed", confirmed_at: "2026-03-09T09:00:00Z", artist: { name: "Marek Kowalczyk" } },
        { status: "soft_booked", confirmed_at: null, artist: { name: "Lena Vogt" } }, // no event
      ],
      openedTiers: [
        { tier: 2, openedAt: "2026-03-10T08:12:00Z", closedAt: null },
        { tier: 1, openedAt: "2026-03-08T08:00:00Z", closedAt: "2026-03-09T08:00:00Z" },
      ],
      limit: 6,
    });
    expect(items[0]).toEqual({ iso: "2026-03-10T08:12:00Z", text: "Round 2 opened" });
    expect(items.map((i) => i.text)).toContain("Marek Kowalczyk booked");
    expect(items.map((i) => i.text)).toContain("Round 1 closed");
    expect(items.map((i) => i.text)).toContain("Round 1 opened");
    expect(items.length).toBeLessThanOrEqual(6);
    const isos = items.map((i) => i.iso);
    expect([...isos].sort((a, b) => b.localeCompare(a))).toEqual(isos);
  });
});
