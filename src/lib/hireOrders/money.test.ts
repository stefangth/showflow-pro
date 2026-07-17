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
});
