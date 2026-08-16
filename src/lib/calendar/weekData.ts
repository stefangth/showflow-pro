/**
 * Pure derivation of the Week lens's time-grid model: positioned session
 * blocks (one per non-null `session1`/`session2`/`session3`) plus an
 * `untimed` bucket for dates whose sessions are all null. No Supabase or
 * React imports — callers pass a plain `entries` array and `anchor` Date.
 */
import { differenceInCalendarDays } from 'date-fns';
import type { MeterSegment, ProducerDateEntry } from './types';
import { bandBounds, sessionMinutes } from './time';
import { periodWindow } from './period';

export interface WeekBlock {
  entryId: string;
  date: Date;
  columnIndex: number; // 0..6 Mon..Sun within the week window
  session: 1 | 2 | 3;
  startMinutes: number; // for vertical position (null-session dates excluded from blocks)
  title: string;
  venue: string | null;
  city: string | null;
  status: ProducerDateEntry['status'];
  meter: MeterSegment[]; // confirmedMain of mainSlots
}

export interface WeekModel {
  weekStart: Date; // Monday
  columns: Date[]; // 7 days Mon..Sun
  band: { startMinutes: number; endMinutes: number };
  blocks: WeekBlock[];
  untimed: { entryId: string; columnIndex: number; title: string }[]; // all-null-session dates
  /** Open main slots per day column (0..6 Mon..Sun): summed `mainSlots -
   *  confirmedMain` (floored at 0) across that day's non-cancelled entries.
   *  Drives the header's `-N` unfilled flag. */
  unfilledByColumn: number[];
}

function meterFor(entry: ProducerDateEntry): MeterSegment[] {
  return Array.from({ length: entry.mainSlots }, (_, i) => ({ filled: i < entry.confirmedMain }));
}

export function toWeekModel(entries: ProducerDateEntry[], anchor: Date): WeekModel {
  const { start, end } = periodWindow(anchor, 'week');
  const weekStart = start;
  const columns = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const inWeek = entries.filter((e) => e.date >= start && e.date <= end);

  const blocks: WeekBlock[] = [];
  const untimed: WeekModel['untimed'] = [];
  const sessionValues: (string | null | undefined)[] = [];
  const unfilledByColumn = Array.from({ length: 7 }, () => 0);

  for (const entry of inWeek) {
    const columnIndex = differenceInCalendarDays(entry.date, weekStart);

    if (columnIndex >= 0 && columnIndex < 7 && entry.status !== 'cancelled') {
      unfilledByColumn[columnIndex] += Math.max(0, entry.mainSlots - entry.confirmedMain);
    }
    const sessions: { session: 1 | 2 | 3; value: string | null }[] = [
      { session: 1, value: entry.session1 },
      { session: 2, value: entry.session2 },
      { session: 3, value: entry.session3 },
    ];

    let hasTimed = false;
    for (const { session, value } of sessions) {
      if (value == null) continue;
      hasTimed = true;
      sessionValues.push(value);
      blocks.push({
        entryId: entry.id,
        date: entry.date,
        columnIndex,
        session,
        startMinutes: sessionMinutes(value),
        title: entry.program,
        venue: entry.venue,
        city: entry.city,
        status: entry.status,
        meter: meterFor(entry),
      });
    }

    if (!hasTimed) {
      untimed.push({ entryId: entry.id, columnIndex, title: entry.program });
    }
  }

  const band = bandBounds(sessionValues);

  return { weekStart, columns, band, blocks, untimed, unfilledByColumn };
}
