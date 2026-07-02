/**
 * Shared tier-fill math for the booking-engine watchers
 * (tier-at-risk-watcher + expire-offers).
 *
 * Why this exists (M2 fix): both watchers used to compare a PER-TIER pending/accepted
 * count against `main_cast_slots + understudy_slots`. That was wrong on three counts:
 *
 *   1. `open-offer-tier` only ever creates primary (`is_understudy:false`) offers, and
 *      those fill `main_cast_slots` — the understudy count is NOT what an offer tier is
 *      trying to fill. Including `understudy_slots` inflated the requirement and produced
 *      false "unfillable" / escalation alarms.
 *   2. Manual bookings carry `offer_tier = NULL`, so a per-tier `.eq('offer_tier', …)`
 *      count made them invisible — a date fully covered by hand still looked empty.
 *   3. With two tiers open, tier-2's small count was compared against the full
 *      requirement, so a healthy date (filled by tier-1) tripped the alarm on tier-2.
 *
 * The fix: the requirement for a primary offer tier is `main_cast_slots`; "can this date
 * still fill" is judged against accepted/confirmed bookings from ALL sources for the date
 * (any tier, including manual `offer_tier IS NULL`), not just the current tier.
 */

export interface ShowSlots {
  main_cast_slots: number | null;
  understudy_slots: number | null;
}

/** A booking row as far as the fill math is concerned. */
export interface BookingLike {
  status?: string | null;
  offer_tier?: number | null;
  offer_expires_at?: string | null;
}

/**
 * The number of slots a primary (non-understudy) offer tier is trying to fill.
 *
 * `open-offer-tier` inserts only `is_understudy:false` offers, which fill the main cast,
 * so the denominator is `main_cast_slots` — NOT `main_cast_slots + understudy_slots`.
 *
 * Returns `null` when the show is unconfigured (main_cast_slots is null); callers must
 * skip the tier in that case (same contract as before).
 */
export function requiredPrimarySlots(slots: ShowSlots): number | null {
  if (slots.main_cast_slots === null || slots.main_cast_slots === undefined) return null;
  return slots.main_cast_slots;
}

/** Accepted holds: soft_booked or confirmed. Counts EVERY row passed in (all sources). */
export function countAccepted(bookings: BookingLike[]): number {
  return bookings.filter((b) => b.status === "soft_booked" || b.status === "confirmed").length;
}

/** Live offers: still 'suggested'. Counts every row passed in. */
export function countPending(bookings: BookingLike[]): number {
  return bookings.filter((b) => b.status === "suggested").length;
}

/**
 * Live (not-yet-expired) pending offers relative to `now`.
 * A suggested booking with no `offer_expires_at`, or one whose expiry is strictly in the
 * future, is still live; one whose expiry is <= now has effectively lapsed.
 */
export function countPendingNotExpired(bookings: BookingLike[], now: Date): number {
  return bookings.filter(
    (b) => b.status === "suggested" && (!b.offer_expires_at || new Date(b.offer_expires_at) > now),
  ).length;
}

/**
 * Today's calendar date (YYYY-MM-DD) in Europe/Berlin, derived from `now`.
 * The booking engine gates everything on Berlin wall-clock, so "past date" is judged in
 * Berlin too (a date is not stale until it is yesterday or earlier in Berlin).
 */
export function berlinDateKey(now: Date): string {
  // en-CA yields ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whether a show_date's calendar date is today or in the future (Berlin).
 * `date` is a plain 'YYYY-MM-DD' string (as stored on show_dates). Past dates return
 * false so the watchers stop re-alerting on dates that can no longer be booked.
 */
export function isFutureOrToday(date: string | null | undefined, now: Date): boolean {
  if (!date) return false;
  // Lexical compare is correct for zero-padded ISO date strings.
  return date.slice(0, 10) >= berlinDateKey(now);
}
