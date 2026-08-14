import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { computeDatePeek } from "./bookingCockpit";

const t = i18n.getFixedT("en", "bookingCopy");

const C = (o: Partial<Record<"confirmedMain" | "confirmedUs" | "acceptedMain" | "acceptedUs", number>>) =>
  ({ confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, ...o });

describe("computeDatePeek", () => {
  it("returns null when slots are unconfigured", () => {
    expect(computeDatePeek({ t, counts: C({}), slots: null })).toBeNull();
  });

  it("2 confirmed main + 2 accepted understudies -> at-risk, meter tones, main-open headline", () => {
    // confirmedMain 2 of 4 leaves 2 main slots open; the 2 accepted are understudies.
    const p = computeDatePeek({ t,
      counts: C({ confirmedMain: 2, acceptedUs: 2 }),
      slots: { main_cast: 4, understudies: 2 },
    })!;
    expect(p.tone).toBe("at-risk");
    expect(p.eyebrowSuffix).toBe("at risk");
    expect(p.acceptedWaiting).toBe(2);
    expect(p.openSlots).toBe(2);
    expect(p.confirmable).toBe(true);
    expect(p.headline).toBe("2 accepted waiting on you · 2 main slots open");
    expect(p.meter.map((s) => s.tone)).toEqual([
      "confirmed", "confirmed", "accepted", "accepted", "open", "open",
    ]);
  });

  it("all confirmed -> filled tone and headline, not confirmable", () => {
    const p = computeDatePeek({ t,
      counts: C({ confirmedMain: 4, confirmedUs: 2 }),
      slots: { main_cast: 4, understudies: 2 },
    })!;
    expect(p.tone).toBe("filled");
    expect(p.eyebrowSuffix).toBe("filled");
    expect(p.headline).toBe("All 6 slots confirmed");
    expect(p.confirmable).toBe(false);
    expect(p.meter.every((s) => s.tone === "confirmed")).toBe(true);
  });

  it("only understudy open -> reports understudy slots open", () => {
    const p = computeDatePeek({ t,
      counts: C({ confirmedMain: 4 }),
      slots: { main_cast: 4, understudies: 2 },
    })!;
    expect(p.headline).toBe("2 understudy slots open");
    expect(p.tone).toBe("at-risk");
  });
});
