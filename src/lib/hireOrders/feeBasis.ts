// How a producer entered the engagement fee for an aggregate (multi-date) order.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same type +
// function (the two runtimes cannot share an import). Change both files in the
// same commit.

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
