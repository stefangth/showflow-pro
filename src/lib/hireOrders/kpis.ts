import { formatMoney } from "@/lib/hireOrders/money";
import type { HireOrderListRow } from "@/data/hireOrders";

export interface OrderKpiStats {
  totalCount: number;
  issuedCount: number;
  awaitingCount: number;
  countersignedCount: number;
  valueCommitted: string;
}

/**
 * Derive the V4 dashboard's headline stats from a (deliberately unfiltered)
 * set of hire orders — callers should pass the full org set, not the
 * status/search-filtered table rows, so the tiles read as a stable overview
 * regardless of what the table below is currently showing.
 *
 * "Issued" counts every order that has ever reached the issued stage or
 * beyond (issued + countersigned); "Awaiting countersign" is the narrower,
 * currently-outstanding subset (status === "issued" only). "Value committed"
 * sums fee_amount across every non-void order, grouped by `fee_currency`.
 * Orgs are expected to usually bill in one currency, so the common case
 * renders a single formatted total; when non-void orders span more than one
 * currency (the wizard/builder/import currency picker makes this producible),
 * rendering a single-currency sum would be silently wrong, so each currency's
 * subtotal is shown instead, joined with " + " (e.g. "€3,000.00 + $1,200.00").
 */
export function computeOrderKpis(orders: HireOrderListRow[]): OrderKpiStats {
  const issuedCount = orders.filter((o) => o.status === "issued" || o.status === "countersigned").length;
  const awaitingCount = orders.filter((o) => o.status === "issued").length;
  const countersignedCount = orders.filter((o) => o.status === "countersigned").length;
  const nonVoid = orders.filter((o) => o.status !== "void");
  const totalsByCurrency = new Map<string, number>();
  for (const o of nonVoid) {
    const currency = o.fee_currency ?? "EUR";
    totalsByCurrency.set(currency, (totalsByCurrency.get(currency) ?? 0) + (o.fee_amount ?? 0));
  }
  const currencyTotals = Array.from(totalsByCurrency.entries());
  const valueCommitted =
    currencyTotals.length > 1
      ? currencyTotals.map(([currency, amount]) => formatMoney(amount, currency)).join(" + ")
      : formatMoney(currencyTotals[0]?.[1] ?? 0, currencyTotals[0]?.[0] ?? orders[0]?.fee_currency ?? "EUR");
  return {
    totalCount: orders.length,
    issuedCount,
    awaitingCount,
    countersignedCount,
    valueCommitted,
  };
}
