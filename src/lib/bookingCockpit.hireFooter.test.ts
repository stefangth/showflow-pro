import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import { computeHireFooter } from "@/lib/bookingCockpit";

const t = i18n.getFixedT("en", "bookingCopy");

const slots = { main_cast: 4, understudies: 2 };

describe("computeHireFooter", () => {
  it("is ready only when the DB status is fully_filled", () => {
    const f = computeHireFooter({ t, status: "fully_filled", slots, confirmedMain: 4, confirmedUnderstudy: 2 });
    expect(f.ready).toBe(true);
    expect(f.badgeLabel).toBe("READY");
    expect(f.detail).toMatch(/All places booked/);
  });

  it("does NOT green-light drafting when one role is short, even if the flat sum hits total", () => {
    // 6 main confirmed, 0 understudies → flat sum 6 >= 6, but status is not
    // fully_filled and understudies are short, so it must stay not-ready.
    const f = computeHireFooter({ t, status: "partially_filled", slots, confirmedMain: 6, confirmedUnderstudy: 0 });
    expect(f.ready).toBe(false);
    expect(f.remaining).toBe(2); // per-role: 0 main short + 2 understudy short
    expect(f.badgeLabel).toBe("2 LEFT");
    expect(f.detail).toBe("Waiting on 2 of 6 places");
  });

  it("counts remaining per role, not as a flat total", () => {
    const f = computeHireFooter({ t, status: "partially_filled", slots, confirmedMain: 1, confirmedUnderstudy: 2 });
    expect(f.remaining).toBe(3); // 3 main short + 0 understudy short
  });

  it("no slot config → zero remaining, not ready", () => {
    const f = computeHireFooter({ t, status: "partially_filled", slots: null, confirmedMain: 0, confirmedUnderstudy: 0 });
    expect(f.ready).toBe(false);
    expect(f.remaining).toBe(0);
  });
});
