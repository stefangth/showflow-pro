import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrdersKpis } from "./OrdersKpis";
import { computeOrderKpis } from "@/lib/hireOrders/kpis";
import type { HireOrderListRow } from "@/data/hireOrders";

/** A minimal HireOrderListRow, only the fields computeOrderKpis reads. */
function order(overrides: Partial<HireOrderListRow> & { id: string }): HireOrderListRow {
  return {
    status: "draft",
    fee_amount: 1000,
    fee_currency: "EUR",
    ...overrides,
  } as HireOrderListRow;
}

describe("computeOrderKpis", () => {
  it("sums fee_amount across non-void orders under one currency when every order shares it", () => {
    const orders = [
      order({ id: "1", status: "draft", fee_amount: 1000, fee_currency: "EUR" }),
      order({ id: "2", status: "issued", fee_amount: 2000, fee_currency: "EUR" }),
      order({ id: "3", status: "void", fee_amount: 5000, fee_currency: "EUR" }),
    ];
    const stats = computeOrderKpis(orders);
    // Void order excluded from the sum (1000 + 2000 = 3000), single currency unchanged.
    expect(stats.valueCommitted).toBe("€3,000.00");
  });

  it("shows a per-currency breakdown, not a wrong single-currency total, when non-void orders span multiple currencies", () => {
    const orders = [
      order({ id: "1", status: "draft", fee_amount: 3000, fee_currency: "EUR" }),
      order({ id: "2", status: "issued", fee_amount: 1200, fee_currency: "USD" }),
    ];
    const stats = computeOrderKpis(orders);
    expect(stats.valueCommitted).toBe("€3,000.00 + $1,200.00");
    // Never renders one currency's symbol over the OTHER currency's amount.
    expect(stats.valueCommitted).not.toBe("€4,200.00");
    expect(stats.valueCommitted).not.toBe("$4,200.00");
  });

  it("ignores a void order's currency when computing the single-currency label", () => {
    // orders[0] (void) is USD, but the only non-void order is EUR -- the total
    // must be labeled EUR, not silently inherit the void order's currency.
    const orders = [
      order({ id: "1", status: "void", fee_amount: 9999, fee_currency: "USD" }),
      order({ id: "2", status: "draft", fee_amount: 500, fee_currency: "EUR" }),
    ];
    const stats = computeOrderKpis(orders);
    expect(stats.valueCommitted).toBe("€500.00");
  });

  it("formats a zero total in the first order's currency when there are no non-void orders", () => {
    const orders = [order({ id: "1", status: "void", fee_amount: 5000, fee_currency: "USD" })];
    const stats = computeOrderKpis(orders);
    expect(stats.valueCommitted).toBe("$0.00");
  });

  it("derives issued/awaiting/countersigned counts independent of the currency mix", () => {
    const orders = [
      order({ id: "1", status: "issued", fee_currency: "EUR" }),
      order({ id: "2", status: "countersigned", fee_currency: "USD" }),
    ];
    const stats = computeOrderKpis(orders);
    expect(stats.issuedCount).toBe(2);
    expect(stats.awaitingCount).toBe(1);
    expect(stats.countersignedCount).toBe(1);
    expect(stats.totalCount).toBe(2);
  });
});

describe("OrdersKpis", () => {
  it("renders the mixed-currency breakdown in the Value committed tile", () => {
    const orders = [
      order({ id: "1", status: "draft", fee_amount: 3000, fee_currency: "EUR" }),
      order({ id: "2", status: "issued", fee_amount: 1200, fee_currency: "USD" }),
    ];
    renderWithProviders(<OrdersKpis orders={orders} />);
    const kpiRegion = screen.getByTestId("orders-kpis");
    const label = within(kpiRegion).getByText("Value committed");
    expect(label.nextElementSibling?.textContent).toBe("€3,000.00 + $1,200.00");
  });
});
