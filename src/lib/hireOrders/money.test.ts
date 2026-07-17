import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats with two decimals and thousands separators", () => {
    expect(formatMoney("4500", "EUR")).toBe("€4,500.00");
    expect(formatMoney(4500.5, "EUR")).toBe("€4,500.50");
  });
});
