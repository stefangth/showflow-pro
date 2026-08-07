import { parseDateOnly } from "@/lib/dates";
import type { OrderData } from "@/lib/hireOrders/types";
import type { HireOrderListRow } from "@/data/hireOrders";

/**
 * Read a resolved snapshot field as a trimmed string ("" when absent).
 *
 * This is the ONE shared copy for the hire-orders list surfaces (HireOrdersPage
 * and OrdersTable, which used to each carry an identical private copy). Several
 * other surfaces (ArtistDashboard.tsx, HireOrderDetailPage.tsx, HireOrdersCard.tsx)
 * keep their own local copy of the same tiny helper per an established pattern
 * predating this file -- not worth chasing into a shared import for a
 * three-line function with no other behavior tied to it.
 */
export function snap(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * The date to key an order's timeframe filter, past-date tint, AND Overdue
 * indicator on: the linked show_date's date when there is one, else the
 * order's own snapshot `data.date` -- a manual "no linked date" order carries
 * its date there instead of on show_dates. Guards the manual value to a clean
 * YYYY-MM-DD before parsing (see snap()); returns null when neither is
 * available.
 *
 * Shared by HireOrdersPage (timeframe filter) and OrdersTable (past tint +
 * Overdue badge) so the three can never drift on what "this order's date"
 * means -- they used to each carry an identical private copy.
 */
export function orderDate(o: HireOrderListRow): Date | null {
  if (o.show_dates?.date) return parseDateOnly(o.show_dates.date);
  const dateStr = snap((o.data ?? {}) as OrderData, "date");
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? parseDateOnly(dateStr) : null;
}
