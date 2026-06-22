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
