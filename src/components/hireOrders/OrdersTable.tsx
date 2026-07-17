import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HireOrderStatusBadge } from "@/components/hireOrders/HireOrderStatusBadge";
import { formatMoney } from "@/lib/hireOrders/money";
import { formatDateDMY } from "@/lib/dates";
import { ChevronRight } from "lucide-react";
import type { HireOrderListRow } from "@/data/hireOrders";
import type { OrderData } from "@/lib/hireOrders/types";

interface Props {
  orders: HireOrderListRow[];
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (id: string) => void;
}

/** Read a resolved snapshot field as a trimmed string ("" when absent) — same
 *  helper as HireOrderDetailPage's `snap`, kept local since it's a two-line
 *  read with no shared state to warrant extraction into a util module. */
function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Artist name: prefer the joined `artists.name`, fall back to the order's
 *  own resolved snapshot (unlinked/manual orders have no joined artist row). */
function rowArtistName(row: HireOrderListRow): string {
  const data = (row.data ?? {}) as OrderData;
  return row.artists?.name || snap(data, "artist_name") || "Unknown artist";
}

/** Venue/date: prefer the joined show_dates row (the live source), fall back
 *  to the resolved snapshot for orders with no linked show_date. */
function rowVenue(row: HireOrderListRow): string {
  const data = (row.data ?? {}) as OrderData;
  return row.show_dates?.venue || snap(data, "venue");
}

function rowDate(row: HireOrderListRow): string {
  const data = (row.data ?? {}) as OrderData;
  return row.show_dates?.date || snap(data, "date");
}

/** The V4 tracking table: order number (mono), artist + venue (stacked),
 *  date (mono), fee (right-aligned, tabular), status badge, and a chevron.
 *  Row click opens the slide-over; the leading checkbox column drives the
 *  bulk bar and is stopped from bubbling into the row click. */
export function OrdersTable({ orders, selected, onToggleOne, onToggleAll, onOpen }: Props) {
  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Select all hire orders" />
          </TableHead>
          <TableHead>Order</TableHead>
          <TableHead>Artist</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Fee</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-8" aria-hidden="true" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const dateStr = rowDate(order);
          const venue = rowVenue(order);
          return (
            <TableRow key={order.id} className="cursor-pointer" onClick={() => onOpen(order.id)}>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={() => onToggleOne(order.id)}
                  aria-label={`Select ${order.order_no}`}
                />
              </TableCell>
              <TableCell className="font-mono text-sm">{order.order_no}</TableCell>
              <TableCell>
                <p className="text-sm font-medium text-foreground">{rowArtistName(order)}</p>
                <p className="text-xs text-muted-foreground">{venue || "—"}</p>
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-sm">
                {dateStr ? formatDateDMY(dateStr) : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">
                {order.fee_amount != null ? formatMoney(order.fee_amount, order.fee_currency) : "—"}
              </TableCell>
              <TableCell>
                <HireOrderStatusBadge status={order.status} />
              </TableCell>
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
  );
}
