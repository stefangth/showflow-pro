/** Shared main-slot deficit helpers.
 *
 *  The calendar surface measures a date's main-slot gap two legitimately
 *  different ways, and this module is the single home for both so the formulas
 *  can never drift apart inline again:
 *
 *  - {@link openToOfferSlots} — "slots with nobody even offered yet". A
 *    confirmed booking, an accepted offer, and a still-pending offer all count
 *    as handled. This is the casting-action number behind the Needs-you queue
 *    ("you still need to cast N people").
 *  - {@link unconfirmedSlots} — "slots not yet confirmed". Accepted/pending
 *    offers still count as unfilled. This is the fill-progress number shown by
 *    the Season load bar / KPI and the Week unfilled flag, and it deliberately
 *    matches the fill meter beside them (which fills on `confirmedMain`).
 *
 *  The two agree only while no offers are in flight; an offer in flight is
 *  "handled" for casting but still "unconfirmed" for progress. Callers pick the
 *  metric that matches what sits next to it on screen — do not swap one for the
 *  other to make cross-lens numbers line up.
 */

/** Structural slot counts — a superset of `ProducerDateEntry`, so any entry
 *  satisfies it, but `acceptedMain`/`pendingMain` are optional so callers that
 *  only track confirmed fill (e.g. a Season cell) can pass just the two fields
 *  {@link unconfirmedSlots} needs. */
export interface SlotCounts {
  mainSlots: number;
  confirmedMain: number;
  acceptedMain?: number;
  pendingMain?: number;
}

/** Main slots with no active booking of any kind (confirmed, accepted, or a
 *  pending offer all count as handled), floored at 0. Drives the Needs-you
 *  action queue. Requires `acceptedMain`/`pendingMain` — the whole point of
 *  this metric is subtracting offers, so a caller omitting them (getting the
 *  unconfirmed count instead) is a bug this type refuses to compile. */
export function openToOfferSlots(entry: Required<SlotCounts>): number {
  const inFlight = entry.confirmedMain + entry.acceptedMain + entry.pendingMain;
  return Math.max(0, entry.mainSlots - inFlight);
}

/** Main slots not yet confirmed (accepted/pending offers still count as
 *  unconfirmed), floored at 0. Drives the Season load bar / KPI and the Week
 *  unfilled flag, matching the confirmed-fill meter beside them. */
export function unconfirmedSlots(entry: SlotCounts): number {
  return Math.max(0, entry.mainSlots - entry.confirmedMain);
}
