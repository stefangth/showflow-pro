import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY } from "@/lib/dates";
import { useHireOrderAction } from "@/hooks/useHireOrders";
import type { HireOrderListRow } from "@/data/hireOrders";

/** Only draft/ready orders can be batch-issued. */
function isIssuable(status: string): boolean {
  return status === "draft" || status === "ready";
}

interface Props {
  orders: HireOrderListRow[];
  orgId: string;
  onRowClick: (id: string) => void;
}

/**
 * The V4 order list: a row-selectable table (checkbox column drives the bulk
 * action bar) plus the table itself. Order number and date render mono; fee
 * is right-aligned tabular. Clicking a row (outside the checkbox) opens the
 * slide-over via `onRowClick`.
 */
export function OrdersTable({ orders, orgId, onRowClick }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const action = useHireOrderAction();

  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));
  const someSelected = selected.size > 0;
  const selectedRows = orders.filter((o) => selected.has(o.id));
  const canIssueSelected = someSelected && selectedRows.every((o) => isIssuable(o.status));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
  };
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleIssueSelected = () => {
    action.mutate(
      { action: "issue", org_id: orgId, order_ids: Array.from(selected) },
      { onSuccess: () => setSelected(new Set()) },
    );
  };

  return (
    <div className="space-y-3">
      {someSelected && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-2">
          <p className="text-sm text-muted-foreground">{selected.size} selected</p>
          <Button size="sm" onClick={handleIssueSelected} disabled={!canIssueSelected || action.isPending}>
            Issue selected
          </Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all orders" />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(o.id)}
                      onCheckedChange={() => toggleRow(o.id)}
                      aria-label={`Select order ${o.order_no}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{o.order_no}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-foreground">{o.artists?.name ?? "Unknown artist"}</div>
                    <div className="text-xs text-muted-foreground">{o.show_dates?.venue || "Not set"}</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm whitespace-nowrap">
                    {o.show_dates?.date ? formatDateDMY(o.show_dates.date) : "Not set"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-sm">
                    {o.fee_amount != null ? formatMoney(o.fee_amount, o.fee_currency) : "Not set"}
                  </TableCell>
                  <TableCell><HireOrderStatusBadge status={o.status} /></TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    No hire orders match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
