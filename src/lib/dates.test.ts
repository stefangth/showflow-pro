import { describe, it, expect } from "vitest";
import { parseDateOnly, formatDateDMY, formatTimestampDMY, formatDateWithWeekday, toDateKey, isPastDate, PAST_DATE_TINT } from "./dates";

describe("parseDateOnly", () => {
  it("parses a YYYY-MM-DD string at local midnight (no UTC drift)", () => {
    const d = parseDateOnly("2026-04-23");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April = 3
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(0);
  });

  it("round-trips with toDateKey", () => {
    expect(toDateKey(parseDateOnly("2026-12-31"))).toBe("2026-12-31");
    expect(toDateKey(parseDateOnly("2026-01-01"))).toBe("2026-01-01");
  });
});

describe("formatDateDMY", () => {
  it("formats a string as dd/MM/yyyy", () => {
    expect(formatDateDMY("2026-04-23")).toBe("23/04/2026");
  });
  it("zero-pads single-digit day and month", () => {
    expect(formatDateDMY("2026-01-05")).toBe("05/01/2026");
  });
  it("accepts a Date object", () => {
    expect(formatDateDMY(new Date(2026, 0, 5))).toBe("05/01/2026");
  });
});

describe("formatTimestampDMY", () => {
  it("formats a full ISO timestamp (timestamptz) without throwing", () => {
    // Regression: formatDateDMY is for date-only strings — parseDateOnly appends
    // 'T00:00:00', so a full timestamp becomes an Invalid Date and date-fns
    // format() throws. show_date_offer_tiers.opened_at/closed_at are timestamptz.
    const iso = "2026-06-21T14:22:43.123456+00:00";
    expect(() => formatTimestampDMY(iso)).not.toThrow();
    expect(formatTimestampDMY(iso)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
  it("formats a UTC noon timestamp as dd/MM/yyyy", () => {
    expect(formatTimestampDMY("2026-06-21T12:00:00+00:00")).toBe("21/06/2026");
  });
  it("uses the UTC calendar date (deterministic regardless of browser timezone)", () => {
    // 23:30 UTC is still the 21st in UTC; a local-tz formatter could roll to the 22nd.
    expect(formatTimestampDMY("2026-06-21T23:30:00Z")).toBe("21/06/2026");
  });
});

describe("formatDateWithWeekday", () => {
  it("prefixes the abbreviated weekday", () => {
    // 2026-04-23 is a Thursday
    expect(formatDateWithWeekday("2026-04-23")).toBe("Thu, 23/04/2026");
  });
});

describe("isPastDate", () => {
  const today = new Date("2026-04-23T10:30:00");

  it("returns true for yesterday", () => {
    expect(isPastDate(new Date("2026-04-22T23:59:59"), today)).toBe(true);
  });

  it("returns false for today, regardless of time-of-day", () => {
    expect(isPastDate(new Date("2026-04-23T00:00:00"), today)).toBe(false);
    expect(isPastDate(new Date("2026-04-23T23:59:59"), today)).toBe(false);
  });

  it("returns false for tomorrow", () => {
    expect(isPastDate(new Date("2026-04-24T00:00:00"), today)).toBe(false);
  });

  it("defaults `today` to now when omitted", () => {
    const twoDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2);
    expect(isPastDate(twoDaysAgo)).toBe(true);
  });
});

describe("PAST_DATE_TINT", () => {
  it("is the shared dimmed-but-interactive class (opacity only, no pointer-events change)", () => {
    expect(PAST_DATE_TINT).toBe("opacity-60");
    expect(PAST_DATE_TINT).not.toMatch(/pointer-events/);
  });
});
