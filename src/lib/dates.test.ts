import { describe, it, expect, afterEach } from "vitest";
import i18n from "@/i18n";
import { parseDateOnly, formatDateDMY, formatTimestampDMY, formatTimestampLocal, formatDateWithWeekday, toDateKey, isPastDate, PAST_DATE_TINT, pastRowClassName, weekdayShort, weekdayShortLabels, formatDayMonthShortYear, formatMonthYear, formatDayMonthYear, formatFullWeekdayDate, berlinDateKey } from "./dates";

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

// The dd/MM/yyyy shape is numeric and locale-invariant; only the weekday name and the
// short-month form follow the active language. These lock the German path so a language
// switch actually reformats. i18n defaults to English, restored after each case.
describe("locale-aware formatting", () => {
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("keeps English numeric shapes and English weekday by default", () => {
    expect(weekdayShort("2026-04-23")).toBe("Thu");
    expect(weekdayShortLabels()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(formatDayMonthShortYear("2026-04-23")).toBe("23 Apr 2026");
  });

  it("uses German weekday names and Monday-first labels under de", async () => {
    await i18n.changeLanguage("de");
    expect(formatDateWithWeekday("2026-04-23")).toBe("Do., 23/04/2026");
    expect(weekdayShort("2026-04-23")).toBe("Do.");
    expect(weekdayShortLabels()).toEqual(["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."]);
    // dd/MM/yyyy stays numeric regardless of language.
    expect(formatDateDMY("2026-04-23")).toBe("23/04/2026");
  });

  // formatMonthYear (calendar header): full month + year, weekday-free.
  it("formatMonthYear renders the full month name in the active language", async () => {
    expect(formatMonthYear(new Date(2026, 2, 1))).toBe("March 2026");
    await i18n.changeLanguage("de");
    expect(formatMonthYear(new Date(2026, 2, 1))).toBe("März 2026");
  });

  // formatDayMonthYear (bookings date column): zero-padded day + short month + year.
  it("formatDayMonthYear zero-pads the day and localizes the short month", async () => {
    expect(formatDayMonthYear("2026-10-23")).toBe("23 Oct 2026");
    expect(formatDayMonthYear("2026-01-05")).toBe("05 Jan 2026");
    await i18n.changeLanguage("de");
    expect(formatDayMonthYear("2026-10-23")).toBe("23 Okt. 2026");
  });

  // formatFullWeekdayDate (cockpit sheet header): full weekday + day + full month + year.
  it("formatFullWeekdayDate localizes the weekday and full month name", async () => {
    // 2026-04-23 is a Thursday.
    expect(formatFullWeekdayDate("2026-04-23")).toBe("Thursday, 23 April 2026");
    await i18n.changeLanguage("de");
    expect(formatFullWeekdayDate("2026-04-23")).toBe("Donnerstag, 23 April 2026");
  });

  // formatTimestampLocal (hire-order created_at/last_sent_at): pins English to en-GB
  // day-first, not the bare 'en' code (which resolves to US month-first M/D/YYYY and
  // would flip a hire-order date from DD/MM to MM/DD). Time-of-day is left to the
  // runner's timezone, so assert only the day-first date ordering, not the exact string.
  it("formatTimestampLocal renders a day-first medium date in the active language", async () => {
    // UTC noon so the calendar day is stable across the CI timezone.
    const iso = "2026-04-05T12:00:00Z";
    const en = formatTimestampLocal(iso);
    // en-GB medium is day-first ("5 Apr 2026, ..."), never US month-first ("Apr 5").
    expect(en).toMatch(/^\d{1,2} \w/);
    expect(en).not.toMatch(/^[A-Za-z]/);
    expect(en).toContain("Apr");
    await i18n.changeLanguage("de");
    const de = formatTimestampLocal(iso);
    // de-DE medium is numeric day-first ("05.04.2026, ..."), day before month.
    expect(de).toMatch(/^\d{2}\.\d{2}\.\d{4}/);
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

describe("pastRowClassName", () => {
  const today = new Date("2026-04-23T10:30:00");

  it("returns PAST_DATE_TINT for a past date", () => {
    expect(pastRowClassName(new Date("2026-04-22T00:00:00"), today)).toBe(PAST_DATE_TINT);
  });

  it("returns undefined for today", () => {
    expect(pastRowClassName(new Date("2026-04-23T00:00:00"), today)).toBeUndefined();
  });

  it("returns undefined for a future date", () => {
    expect(pastRowClassName(new Date("2026-04-24T00:00:00"), today)).toBeUndefined();
  });

  it("returns undefined for a null date (unparsable / missing)", () => {
    expect(pastRowClassName(null, today)).toBeUndefined();
  });

  it("defaults `today` to now when omitted", () => {
    const twoDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 2);
    expect(pastRowClassName(twoDaysAgo)).toBe(PAST_DATE_TINT);
  });
});

describe("berlinDateKey", () => {
  it("returns the Berlin calendar date for a UTC instant", () => {
    // 2026-06-01T23:30:00Z is 2026-06-02 01:30 CEST (Berlin) — already the next day.
    expect(berlinDateKey(new Date("2026-06-01T23:30:00.000Z"))).toBe("2026-06-02");
    // 2026-06-01T12:00:00Z is still 2026-06-01 in Berlin.
    expect(berlinDateKey(new Date("2026-06-01T12:00:00.000Z"))).toBe("2026-06-01");
  });

  it("matches the Deno twin's behavior (supabase/functions/_shared/tierFill.ts)", () => {
    // Same fixtures as tierFill.test.ts's berlinDateKey coverage, so the two
    // runtimes agree on "today" for the booking engine's Berlin-anchored reads.
    expect(berlinDateKey(new Date("2026-01-15T05:00:00.000Z"))).toBe("2026-01-15");
    expect(berlinDateKey(new Date("2026-01-14T22:30:00.000Z"))).toBe("2026-01-14");
  });
});
