import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { computeOrderKpis } from "@/lib/hireOrders/kpis";
import type { HireOrderListRow } from "@/data/hireOrders";

interface Props {
  orders: HireOrderListRow[];
}

/** The four V4 KPI tiles: Issued / Awaiting countersign / Countersigned / Value committed. */
export function OrdersKpis({ orders }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const stats = computeOrderKpis(orders);
  const tiles: { label: string; value: string }[] = [
    { label: t("ordersKpis.issued"), value: String(stats.issuedCount) },
    { label: t("ordersKpis.awaiting"), value: String(stats.awaitingCount) },
    { label: t("ordersKpis.countersigned"), value: String(stats.countersignedCount) },
    { label: t("ordersKpis.valueCommitted"), value: stats.valueCommitted },
  ];
  return (
    <div data-testid="orders-kpis" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{t.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
