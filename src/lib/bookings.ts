/**
 * Pure booking/eligibility derivations extracted from ShowDateDetailSheet.
 * No Supabase, no React — safe to unit-test directly.
 */

export interface BookingLike {
  artist_id: string;
  status: string;
  is_understudy: boolean;
}

export interface BookingGroups<T extends BookingLike> {
  /** All non-cancelled bookings. */
  active: T[];
  /** Active, non-understudy. */
  main: T[];
  /** Active understudies. */
  understudy: T[];
  /** Set of artist_ids with any active booking. */
  bookedArtistIds: Set<string>;
  /** Count of confirmed main-cast bookings. */
  confirmedMainCount: number;
  /** Count of confirmed understudy bookings. */
  confirmedUnderstudyCount: number;
}

export function deriveBookingGroups<T extends BookingLike>(
  bookings: T[] | null | undefined,
): BookingGroups<T> {
  const active = (bookings ?? []).filter((b) => b.status !== "cancelled");
  const main = active.filter((b) => !b.is_understudy);
  const understudy = active.filter((b) => b.is_understudy);
  return {
    active,
    main,
    understudy,
    bookedArtistIds: new Set(active.map((b) => b.artist_id)),
    confirmedMainCount: main.filter((b) => b.status === "confirmed").length,
    confirmedUnderstudyCount: understudy.filter((b) => b.status === "confirmed").length,
  };
}

/** Eligibility-derived cast ids, minus any date-level overrides. */
export function computeInheritedCastIds(
  eligibilityCastIds: string[] | null | undefined,
  overrideCastIds: Set<string>,
): Set<string> {
  return new Set((eligibilityCastIds ?? []).filter((cid) => !overrideCastIds.has(cid)));
}

/**
 * Build the `bookings` update payload for a status transition.
 *
 * NOTE: matches current production behavior exactly — it only *sets*
 * confirmed_at / cancelled_at and never clears a stale stamp on the reverse
 * transition. See part2-bug-log.md ("booking timestamp never cleared").
 */
export function bookingStatusUpdate(status: string, now: Date): Record<string, unknown> {
  const updates: Record<string, unknown> = { status };
  if (status === "confirmed") updates.confirmed_at = now.toISOString();
  if (status === "cancelled") updates.cancelled_at = now.toISOString();
  return updates;
}
