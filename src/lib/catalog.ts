/** A row is "synced" (Airtable-owned) when its link key is set. */
export const isSyncedShow = (s: { airtable_program_key: string | null }): boolean => !!s.airtable_program_key;
export const isSyncedDate = (d: { airtable_record_id: string | null }): boolean => !!d.airtable_record_id;

/** Hard-delete is allowed only for a manual (non-synced) date with no bookings. Else: Cancel. */
export const canHardDeleteDate = (a: { synced: boolean; bookingCount: number }): boolean =>
  !a.synced && a.bookingCount === 0;

/** Hard-delete is allowed only for a manual (non-synced) show with no dates. Else: Archive. */
export const canHardDeleteShow = (a: { synced: boolean; dateCount: number }): boolean =>
  !a.synced && a.dateCount === 0;

/** First non-cancelled date with the same show_id + date (soft create warning), else null. */
export function findDuplicateDate<T extends { show_id: string; date: string; status: string }>(
  existing: T[],
  q: { showId: string; date: string },
): T | null {
  return existing.find((r) => r.show_id === q.showId && r.date === q.date && r.status !== "cancelled") ?? null;
}

/** Next display order = max(sort_order ?? 0) + 1. */
export function nextSortOrder(shows: { sort_order: number | null }[]): number {
  return shows.reduce((max, s) => Math.max(max, s.sort_order ?? 0), 0) + 1;
}

/**
 * Reconcile a locally-held drag order (`prev`) with freshly-fetched/filtered rows
 * (`next`) without clobbering an in-progress user reorder.
 *
 * Returns `prev` (preserving the user's order) when both hold the SAME set of ids —
 * a refetch that returns the same productions must not snap a local reorder back to
 * server order. Returns `next` only when the membership actually changed (add /
 * remove / filter switch), so genuinely new data is still adopted. Returns the same
 * `prev` reference when already in sync so callers can bail out of a state update.
 */
export function reconcileDragOrder<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const sameSequence =
    prev.length === next.length && prev.every((s, i) => next[i] && s.id === next[i].id);
  if (sameSequence) return prev;

  const nextIds = new Set(next.map((s) => s.id));
  const prevIds = new Set(prev.map((s) => s.id));
  const sameMembers =
    nextIds.size === prevIds.size && [...nextIds].every((id) => prevIds.has(id));
  // Same productions, only reordered locally → keep the user's order.
  return sameMembers ? prev : next;
}
