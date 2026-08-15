import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  addWeeks,
  format,
} from 'date-fns';

export type LensPeriod = 'month' | 'week' | 'season';

const WEEK_OPTS = { weekStartsOn: 1 as const };

/**
 * The [start, end] window (inclusive calendar bounds) containing `anchor`
 * for the given lens period. Weeks run Monday..Sunday. `season` is a
 * 3-calendar-month span (anchor's month start through anchor+2 months end)
 * — a placeholder until the org models a season explicitly (spec §4.4).
 */
export function periodWindow(anchor: Date, period: LensPeriod): { start: Date; end: Date } {
  switch (period) {
    case 'week':
      return { start: startOfWeek(anchor, WEEK_OPTS), end: endOfWeek(anchor, WEEK_OPTS) };
    case 'season':
      return { start: startOfMonth(anchor), end: endOfMonth(addMonths(anchor, 2)) };
    case 'month':
    default:
      return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }
}

/**
 * A 42-cell (6-week) Monday-first month grid for the month containing
 * `anchor`. Leading pad is `(getDay(monthStart)+6)%7` nulls; the grid is
 * then padded at the end to a multiple of 7.
 */
export function monthMatrix(anchor: Date): (Date | null)[] {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const leadingPad = (monthStart.getDay() + 6) % 7;

  const cells: (Date | null)[] = Array.from({ length: leadingPad }, () => null);
  for (let day = 1; day <= monthEnd.getDate(); day++) {
    cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

/** Moves `anchor` by one unit of `period` in direction `dir` (-1 back, 1 forward). */
export function shiftPeriod(anchor: Date, period: LensPeriod, dir: -1 | 1): Date {
  switch (period) {
    case 'week':
      return addWeeks(anchor, dir);
    case 'season':
      return addMonths(anchor, dir * 3);
    case 'month':
    default:
      return addMonths(anchor, dir);
  }
}

/** Human-readable label for the period window containing `anchor`. */
export function periodLabel(anchor: Date, period: LensPeriod): string {
  switch (period) {
    case 'week': {
      const { start, end } = periodWindow(anchor, 'week');
      return `${format(start, 'd MMM')} - ${format(end, 'd MMM yyyy')}`;
    }
    case 'season': {
      const { start, end } = periodWindow(anchor, 'season');
      return `${format(start, 'MMM')} - ${format(end, 'MMM yyyy')}`;
    }
    case 'month':
    default:
      return format(anchor, 'MMMM yyyy');
  }
}
