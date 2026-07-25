// How a producer entered the engagement fee for an aggregate (multi-date) order.
//
// DUAL-HOME PAIR: src/lib/hireOrders/feeBasis.ts generates
// supabase/functions/_shared/feeBasis.ts (the edge runtime can't import from
// src/). Edit src/lib/hireOrders/feeBasis.ts, then run `npm run sync:mirrors`;
// never hand-edit supabase/functions/_shared/feeBasis.ts directly. CI's
// sync:mirrors:check fails if the two drift. supabase/functions/_shared/
// hireOrders.ts re-exports computeFeeTotal and FeeBasis from the generated
// file, so edge callers can import either from hireOrders.ts or from
// feeBasis.ts directly.

/** "per_date": the entered amount is charged once per engagement date.
 *  "total": the entered amount already covers every date. */
export type FeeBasis = "per_date" | "total";

/**
 * Total payable for an order, given the amount the producer typed and how many
 * engagement dates the order actually covers.
 *
 * Multiplies in integer cents: `500.1 * 3` in binary floating point is
 * 1500.3000000000002, which would be stored and printed verbatim.
 *
 * Defensive no-ops (return the amount unchanged) for a non-finite amount or a
 * date count that is not a positive integer, so a malformed caller can never
 * turn a real fee into NaN or zero.
 */
export function computeFeeTotal(
  perDateAmount: number,
  dateCount: number,
  basis: FeeBasis,
): number {
  if (basis === "total") return perDateAmount;
  if (!Number.isFinite(perDateAmount)) return perDateAmount;
  if (!Number.isInteger(dateCount) || dateCount < 1) return perDateAmount;
  return (Math.round(perDateAmount * 100) * dateCount) / 100;
}
