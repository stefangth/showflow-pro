import { describe, it, expect } from "vitest";
import { computeOrderKpis } from "./kpis";
import type { HireOrderListRow } from "@/data/hireOrders";

// Only the fields computeOrderKpis reads; cast once at the boundary so the fixture stays terse.
const row = (status: string, fee_amount: number | null, fee_currency: string | null): HireOrderListRow =>
  ({ status, fee_amount, fee_currency } as unknown as HireOrderListRow);

describe("computeOrderKpis value formatting", () => {
  it("counts by stage and sums non-void fees per currency", () => {
    const stats = computeOrderKpis([
      row("issued", 3000, "EUR"),
      row("countersigned", 1500, "EUR"),
      row("void", 999, "EUR"),
    ]);
    expect(stats.totalCount).toBe(3);
    expect(stats.issuedCount).toBe(2); // issued + countersigned
    expect(stats.awaitingCount).toBe(1); // status === "issued" only
    expect(stats.countersignedCount).toBe(1);
    expect(stats.valueCommitted).toBe("€4,500.00"); // void excluded; en-US default
  });

  it("joins multiple currencies with ' + '", () => {
    const stats = computeOrderKpis([row("issued", 3000, "EUR"), row("issued", 1200, "USD")]);
    expect(stats.valueCommitted).toBe("€3,000.00 + $1,200.00");
  });

  it("formats the committed value in the given locale (guards the KPI wiring)", () => {
    const stats = computeOrderKpis([row("issued", 4500.5, "EUR")], "de");
    expect(stats.valueCommitted).toBe("€4.500,50");
  });
});
