import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats with two decimals and thousands separators", () => {
    expect(formatMoney("4500", "EUR")).toBe("€4,500.00");
    expect(formatMoney(4500.5, "EUR")).toBe("€4,500.50");
  });

  it("prefixes each known currency with its symbol", () => {
    expect(formatMoney("4500", "USD")).toBe("$4,500.00");
    // CHF's trailing space is deliberate: it reads as a word, not a glyph.
    expect(formatMoney("4500", "CHF")).toBe("CHF 4,500.00");
  });

  it("falls back to a spaced currency code when the symbol is unknown", () => {
    expect(formatMoney("4500", "SEK")).toBe("SEK 4,500.00");
  });

  it("defaults to the en-US number shape when no locale is given", () => {
    // The default keeps the edge PDF renderer (which passes no locale) byte-identical.
    expect(formatMoney("4500.5", "EUR")).toBe("€4,500.50");
  });

  it("uses the given locale's separators without touching the currency symbol", () => {
    // German groups with '.' and decimals with ',', but the symbol prefix is unchanged.
    expect(formatMoney("4500.5", "EUR", "de")).toBe("€4.500,50");
    expect(formatMoney("4500", "CHF", "de")).toBe("CHF 4.500,00");
  });
});
