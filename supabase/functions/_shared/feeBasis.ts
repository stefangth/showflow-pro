// GENERATED FILE. Do not edit.
// Source: src/lib/hireOrders/feeBasis.ts
// Regenerate: npm run sync:mirrors
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

/**
 * Every legal FeeBasis value, keyed as a Record so the object literal fails to
 * compile if a member is ever added to the FeeBasis union without a matching
 * key here — the exhaustiveness is enforced by the type checker, not by
 * remembering to update a hand-written list of string comparisons.
 */
const FEE_BASIS_VALUES: Record<FeeBasis, true> = { per_date: true, total: true };

/**
 * True only for the exact legal FeeBasis strings. Both a stored
 * `hire_order_defaults.default_fee_basis` and a request's `fee_basis` are
 * hand-editable JSON with nothing validating them on the way in, so either can
 * be "", "weekly", null, or any other garbage. Every reader (settings UI,
 * edge-function request validation, defaults resolution) must agree on what is
 * legal, so they all call THIS — a second hand-rolled `!== "per_date" && !==
 * "total"` somewhere would start rejecting a future third member that the
 * Record above already accepts.
 *
 * Uses `hasOwnProperty` rather than `in`: `in` walks the prototype chain, so
 * "toString"/"constructor"/"hasOwnProperty" would otherwise pass straight
 * through as if they were legal FeeBasis values.
 */
export function isFeeBasis(value: unknown): value is FeeBasis {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(FEE_BASIS_VALUES, value);
}

/**
 * A money amount as integer cents, or null when it is not a usable amount.
 * Money is compared in cents, never as floats.
 *
 * Snapshot fees are stored as either a number or its string spelling
 * (`4500` / `"4500.00"`), so both must read as the same amount. `""` is NOT
 * zero: `Number("")` is 0, which would make a blanked fee compare equal to a
 * real zero fee.
 */
export function feeCents(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

/**
 * True when a stored per-date breakdown still explains the stored total:
 * `fee_per_date x dateCount === fee`, compared in integer cents.
 *
 * `fee_basis`/`fee_per_date` are derived at draft time and any later writer
 * that changes `fee` without clearing them leaves a contradiction behind. This
 * is the single predicate for spotting one, so the renderer can refuse to
 * print false arithmetic onto an immutable document and a writer can decide
 * whether the fields it holds are still valid.
 */
export function feeBreakdownReconciles(
  perDateAmount: unknown,
  total: unknown,
  dateCount: number,
): boolean {
  const perDate = feeCents(perDateAmount);
  const totalCents = feeCents(total);
  if (perDate === null || totalCents === null) return false;
  if (!Number.isInteger(dateCount) || dateCount < 1) return false;
  return perDate * dateCount === totalCents;
}
