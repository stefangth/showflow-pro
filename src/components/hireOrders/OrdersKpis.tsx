import { Card, CardContent } from "@/components/ui/card";
import { FileText, Clock, CheckCircle2, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/hireOrders/money";
import type { HireOrderListRow } from "@/data/hireOrders";

/**
 * Sum of `fee_amount` across every non-void order, with the currency of the
 * first such order (fee-only v1 assumes a single org currency; see
 * `formatMoney`). Exported so the page header's meta line ("<n> orders ·
 * <sum> committed") shares this exact figure with the KPI tile below it.
 */
export function committedValue(orders: HireOrderListRow[]): { total: number; currency: string } {
  const committed = orders.filter((o) => o.status !== "void" && o.fee_amount != null);
  const total = committed.reduce((sum, o) => sum + Number(o.fee_amount), 0);
  const currency = committed[0]?.fee_currency ?? "EUR";
  return { total, currency };
}

interface Props {
  orders: HireOrderListRow[];
}

interface Tile {
  label: string;
  value: string;
  icon: typeof FileText;
}

/**
 * The four KPI tiles atop the V4 tracking dashboard. "Issued" is a
 * CUMULATIVE count — every order that has ever been sent to an artist
 * (`issued_at` set), regardless of its current status — while "Awaiting
 * countersign" and "Countersigned" split that same population by CURRENT
 * status. So Issued >= Awaiting + Countersigned whenever an order was issued
 * and later voided.
 */
export function OrdersKpis({ orders }: Props) {
  const issued = orders.filter((o) => !!o.issued_at).length;
  const awaiting = orders.filter((o) => o.status === "issued").length;
  const countersigned = orders.filter((o) => o.status === "countersigned").length;
  const { total, currency } = committedValue(orders);

  const tiles: Tile[] = [
    { label: "Issued", value: String(issued), icon: FileText },
    { label: "Awaiting countersign", value: String(awaiting), icon: Clock },
    { label: "Countersigned", value: String(countersigned), icon: CheckCircle2 },
    { label: "Value committed", value: formatMoney(total, currency), icon: Wallet },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <p className="text-sm font-medium text-muted-foreground">{t.label}</p>
              <t.icon className="h-5 w-5 text-muted-foreground opacity-40" aria-hidden="true" />
            </div>
            <p className="mt-3 font-display text-[28px] font-semibold tracking-tight tabular-nums">{t.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
