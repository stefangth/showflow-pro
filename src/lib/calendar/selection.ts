import { parseDateOnly, toDateKey } from '@/lib/dates';

/** A drag/click range selection, stored as inclusive `yyyy-MM-dd` date keys.
 *  `anchor` is where the selection started; `focus` is the other end (may be
 *  before or after the anchor). */
export interface RangeSelection { anchor: string; focus: string }

/** Every date key covered by `sel`, inclusive, ascending, regardless of
 *  whether `anchor` or `focus` comes first. Returns `[]` for `null`. */
export function selectedKeys(sel: RangeSelection | null): string[] {
  if (!sel) return [];

  const anchorDate = parseDateOnly(sel.anchor);
  const focusDate = parseDateOnly(sel.focus);
  const [start, end] = anchorDate <= focusDate ? [anchorDate, focusDate] : [focusDate, anchorDate];

  const keys: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/** Moves the selection's `focus` to `key`, keeping the existing `anchor` in
 *  place. Starting from `null`, begins a new single-day selection at `key`. */
export function extendTo(sel: RangeSelection | null, key: string): RangeSelection {
  if (!sel) return { anchor: key, focus: key };
  return { anchor: sel.anchor, focus: key };
}

/** Clears the current selection. */
export function clearSelection(): null {
  return null;
}
