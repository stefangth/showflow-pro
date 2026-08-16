/**
 * Pure derivation of the Season lens's program×day heatmap grid plus its KPI
 * summary. No Supabase or React imports — callers pass a plain `entries`
 * array, an `anchor` Date, and (for the KPIs) the set of date ids that are
 * ready for a hire order.
 *
 * Rows are keyed by `showId` (the production id), never by `program` /
 * `sub_program` — two different shows can share the same program+sub_program
 * pair, which would silently merge their dates into one row if we keyed on
 * that instead. `program` is falsy-coalescable (nullable upstream, always a
 * string here), so a blank program falls back to `sub_program` alone, then
 * to the date's venue, then to a literal "Untitled" — see `rowLabel` below.
 */
import { startOfWeek, differenceInCalendarDays } from 'date-fns';
import type { ProducerDateEntry } from './types';
import { periodWindow } from './period';
import { formatDateDMY } from '@/lib/dates';

export interface SeasonCell {
  date: Date;
  dateId: string | null; // null = no date for this show on this day
  filledMain: number;
  mainSlots: number;
  status: ProducerDateEntry['status'] | null;
  intensity: number; // 0..1 = filledMain/mainSlots (0 when mainSlots is 0)
}

export interface SeasonRow {
  showId: string;
  label: string; // "program · sub_program" (trimmed; blank program → sub_program alone → venue → "Untitled")
  cells: SeasonCell[]; // one per day column, in window order
}

export interface SeasonModel {
  days: Date[]; // the window's day columns
  rows: SeasonRow[];
  loadByDay: { date: Date; openMainSlots: number }[]; // the "Unfilled slots" load-bar row
}

export interface SeasonKpis {
  unfilledMainSlots: number;
  /** Count of in-window non-cancelled dates that still have an open main slot
   *  — the "across N dates" context under the unfilled-slots KPI. */
  unfilledDates: number;
  heaviestWeekLabel: string;
  /** Dates in, and open main slots across, the heaviest week — the
   *  "N dates · M slots open" context under the heaviest-week KPI. */
  heaviestWeekDates: number;
  heaviestWeekOpen: number;
  readyForHireOrder: number;
}

/** "program · sub_program" when both present; falls back to sub_program
 *  alone, then the date's venue, then a literal "Untitled". */
function rowLabel(entry: ProducerDateEntry): string {
  const parts = [entry.program, entry.subProgram].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.join(' · ');
  return entry.venue ?? 'Untitled';
}

/** Day-by-day list of Dates from `start` through `end`, inclusive. */
function buildDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function emptyCell(date: Date): SeasonCell {
  return { date, dateId: null, filledMain: 0, mainSlots: 0, status: null, intensity: 0 };
}

export function toSeasonModel(entries: ProducerDateEntry[], anchor: Date): SeasonModel {
  const { start, end } = periodWindow(anchor, 'season');
  const days = buildDays(start, end);
  const inWindow = entries.filter((e) => e.date >= start && e.date <= end);

  const rowsByShow = new Map<string, SeasonRow>();

  for (const entry of inWindow) {
    const showId = entry.showId ?? entry.id;
    let row = rowsByShow.get(showId);
    if (!row) {
      row = { showId, label: rowLabel(entry), cells: days.map(emptyCell) };
      rowsByShow.set(showId, row);
    }

    const index = differenceInCalendarDays(entry.date, start);
    if (index < 0 || index >= row.cells.length) continue;

    row.cells[index] = {
      date: days[index],
      dateId: entry.id,
      filledMain: entry.confirmedMain,
      mainSlots: entry.mainSlots,
      status: entry.status,
      intensity: entry.mainSlots > 0 ? entry.confirmedMain / entry.mainSlots : 0,
    };
  }

  const rows = Array.from(rowsByShow.values());

  const loadByDay = days.map((date, index) => {
    let openMainSlots = 0;
    for (const row of rows) {
      const cell = row.cells[index];
      if (cell.dateId == null) continue;
      // Exclude cancelled dates so the load bar agrees with the "Unfilled
      // main slots" KPI, which also zeroes cancelled deficits.
      if (cell.status === 'cancelled') continue;
      openMainSlots += Math.max(0, cell.mainSlots - cell.filledMain);
    }
    return { date, openMainSlots };
  });

  return { days, rows, loadByDay };
}

export function seasonKpis(entries: ProducerDateEntry[], anchor: Date, readyIds: Set<string>): SeasonKpis {
  const { start, end } = periodWindow(anchor, 'season');
  const inWindow = entries.filter((e) => e.date >= start && e.date <= end);

  let unfilledMainSlots = 0;
  let unfilledDates = 0;
  let readyForHireOrder = 0;
  const weekCounts = new Map<number, { monday: Date; count: number; open: number }>();

  for (const entry of inWindow) {
    const deficit = entry.status === 'cancelled' ? 0 : Math.max(0, entry.mainSlots - entry.confirmedMain);
    if (entry.status !== 'cancelled') {
      unfilledMainSlots += deficit;
      if (deficit > 0) unfilledDates++;
    }
    if (readyIds.has(entry.id)) readyForHireOrder++;

    // Heaviest-week bucket excludes cancelled dates entirely, so its "N dates"
    // count and "M slots open" sum stay consistent with each other.
    if (entry.status !== 'cancelled') {
      const monday = startOfWeek(entry.date, { weekStartsOn: 1 });
      const key = monday.getTime();
      const bucket = weekCounts.get(key);
      if (bucket) {
        bucket.count++;
        bucket.open += deficit;
      } else {
        weekCounts.set(key, { monday, count: 1, open: deficit });
      }
    }
  }

  let heaviestWeekLabel = '';
  let heaviestWeekDates = 0;
  let heaviestWeekOpen = 0;
  let maxCount = 0;
  for (const { monday, count, open } of weekCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      heaviestWeekLabel = formatDateDMY(monday);
      heaviestWeekDates = count;
      heaviestWeekOpen = open;
    }
  }

  return {
    unfilledMainSlots,
    unfilledDates,
    readyForHireOrder,
    heaviestWeekLabel,
    heaviestWeekDates,
    heaviestWeekOpen,
  };
}
