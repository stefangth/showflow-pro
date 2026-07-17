import { Card, CardContent } from "@/components/ui/card";
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
 * sums fee_amount across every non-void order, using the first order's
 * currency as a simple single-currency stand-in — orgs are expected to bill
 * in one currency; a true multi-currency total is out of scope for v1.
 */
export function computeOrderKpis(orders: HireOrderListRow[]): OrderKpiStats {
  const issuedCount = orders.filter((o) => o.status === "issued" || o.status === "countersigned").length;
  const awaitingCount = orders.filter((o) => o.status === "issued").length;
  const countersignedCount = orders.filter((o) => o.status === "countersigned").length;
  const nonVoid = orders.filter((o) => o.status !== "void");
  const currency = orders[0]?.fee_currency ?? "EUR";
  const total = nonVoid.reduce((sum, o) => sum + (o.fee_amount ?? 0), 0);
  return {
    totalCount: orders.length,
    issuedCount,
    awaitingCount,
    countersignedCount,
    valueCommitted: formatMoney(total, currency),
  };
}

interface Props {
  orders: HireOrderListRow[];
}

/** The four V4 KPI tiles: Issued / Awaiting countersign / Countersigned / Value committed. */
export function OrdersKpis({ orders }: Props) {
  const stats = computeOrderKpis(orders);
  const tiles: { label: string; value: string }[] = [
    { label: "Issued", value: String(stats.issuedCount) },
    { label: "Awaiting countersign", value: String(stats.awaitingCount) },
    { label: "Countersigned", value: String(stats.countersignedCount) },
    { label: "Value committed", value: stats.valueCommitted },
  ];
  return (
    <div data-testid="orders-kpis" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{t.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
