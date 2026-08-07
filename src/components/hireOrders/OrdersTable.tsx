import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { BatchIssuePreflightDialog, type BatchPreflightOrder } from "./BatchIssuePreflightDialog";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY, parseDateOnly, isPastDate, PAST_DATE_TINT } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { OrderData } from "@/lib/hireOrders/types";
import { useHireOrderAction, type IssueResult } from "@/hooks/useHireOrders";
import type { HireOrderListRow } from "@/data/hireOrders";

/** Only draft/ready orders can be batch-issued. */
function isIssuable(status: string): boolean {
  return status === "draft" || status === "ready";
}

/** Read a resolved snapshot field as a trimmed string ("" when absent). Mirrors
 *  the same small helper in ArtistDashboard.tsx / HireOrderDetailPage.tsx /
 *  HireOrdersCard.tsx (kept local per that established pattern rather than a
 *  shared import). */
function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** The date to key an order's past/upcoming state on: the linked show_date's
 *  date when there is one, else the order's own snapshot `data.date` -- a
 *  manual "no linked date" order carries its date there instead. Guards the
 *  manual value to a clean YYYY-MM-DD before parsing (see snap()); returns
 *  null when neither is available, same as before this fallback existed. */
function orderDate(o: HireOrderListRow): Date | null {
  if (o.show_dates?.date) return parseDateOnly(o.show_dates.date);
  const dateStr = snap((o.data ?? {}) as OrderData, "date");
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? parseDateOnly(dateStr) : null;
}

interface Props {
  orders: HireOrderListRow[];
  orgId: string;
  onRowClick: (id: string) => void;
}

/**
 * The V4 order list: a row-selectable table (checkbox column drives the bulk
 * action bar) plus the table itself. Order number and date render mono; fee
 * is right-aligned tabular. Clicking a row (outside the checkbox), or
 * focusing it and pressing Enter/Space, opens the slide-over via
 * `onRowClick`. The checkbox cell stops both click and keydown propagation
 * so toggling selection (mouse or keyboard) never also opens the row.
 */
export function OrdersTable({ orders, orgId, onRowClick }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const action = useHireOrderAction();

  // Prune the selection to whatever is currently present in `orders`: the
  // caller (HireOrdersPage) re-derives this list on every status-chip click
  // and search keystroke, and a row selected before such a change must not
  // linger in `selected` once it scrolls out of view. Without this, a stale
  // id could sit in `selected` unrevalidated against its current status and
  // still reach the issue mutation. Returning the same Set reference when
  // nothing changed is a no-op setState (React bails out of the re-render).
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(orders.map((o) => o.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [orders]);

  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));
  const someSelected = selected.size > 0;
  // Rows currently both selected AND visible. Guarding on `.length ===
  // selected.size` (rather than a bare `.every`, which is vacuously true on
  // an empty array) closes the window — before the prune effect above has
  // flushed — where every visible selected row happens to be issuable but
  // the selection also still holds hidden, unrevalidated ids.
  const selectedRows = orders.filter((o) => selected.has(o.id));
  const canIssueSelected =
    someSelected && selectedRows.length === selected.size && selectedRows.every((o) => isIssuable(o.status));

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

  const handleIssueSelected = () => setBatchOpen(true);

  const issueIds = (idsToIssue: string[]) => {
    if (idsToIssue.length === 0) return;
    action.mutate(
      { action: "issue", org_id: orgId, order_ids: idsToIssue },
      {
        // Only drop the ids that actually succeeded -- a per-row validation
        // failure (e.g. missing fee) must keep its order checked so the
        // producer can fix it and retry immediately, instead of losing the
        // selection and having to re-find the failed rows in the table.
        onSuccess: (data) => {
          const failedIds = new Set(((data ?? {}) as IssueResult).failed?.map((f) => f.order_id) ?? []);
          setSelected((prev) => {
            const next = new Set(prev);
            for (const id of idsToIssue) {
              if (!failedIds.has(id)) next.delete(id);
            }
            return next;
          });
        },
      },
    );
    setBatchOpen(false);
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
      <BatchIssuePreflightDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        orgId={orgId}
        orders={orders
          .filter((o) => selected.has(o.id) && isIssuable(o.status))
          .map((o) => ({
            id: o.id,
            order_no: o.order_no,
            artistName: o.artists?.name ?? "Unknown artist",
            data: (o.data ?? {}) as OrderData,
            terms_variant: o.terms_variant,
          } satisfies BatchPreflightOrder))}
        onConfirm={issueIds}
        isIssuing={action.isPending}
      />
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
              {orders.map((o) => {
                const rowDate = orderDate(o);
                return (
                <TableRow
                  key={o.id}
                  className={cn(
                    'cursor-pointer',
                    rowDate && isPastDate(rowDate) && PAST_DATE_TINT,
                  )}
                  onClick={() => onRowClick(o.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(o.id);
                    }
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
                );
              })}
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
