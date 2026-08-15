import type { MeterSegment, MonthGridCell, MonthGridChip, ProducerDateEntry, ProducerStatus } from './types';
import type { DateBookingCounts } from '@/data/bookings';
import { showSlots } from '@/lib/settings';
import { isPastDate, parseDateOnly, toDateKey } from '@/lib/dates';
import { monthMatrix } from './period';
import { PRODUCER_TONES } from './tone';

/**
 * The structural row shape this module consumes — matches `SHOW_DATE_LIST_COLS`
 * in `src/data/showDates.ts` (`fetchShowDatesList`'s select), trimmed to the
 * fields this merge actually reads. Declared locally rather than imported from
 * `ShowsBookingsPage.tsx`'s page-local `ShowDateRow` per the Wave A2 ruling —
 * this is a pure lib module and should not depend on a page component.
 */
export interface ProducerShowDateRow {
  id: string;
  date: string;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  status: 'open' | 'partially_filled' | 'fully_filled' | 'cancelled';
  notes: string | null;
  city_id: string | null;
  show_id: string;
  custom: Record<string, unknown> | null;
  show: {
    program: string | null;
    sub_program: string | null;
    status: string;
    main_cast_slots: number | null;
    understudy_slots: number | null;
  };
  city: { name: string } | null;
}

/** Mirrors `ShowsBookingsPage.tsx`'s `displayStatus`: an 'open' date whose
 *  show has no usable slot config (see `showSlots`) reads as 'unconfigured'. */
function displayStatus(row: ProducerShowDateRow): ProducerStatus {
  if (row.status === 'open' && !showSlots(row.show)) {
    return 'unconfigured';
  }
  return row.status;
}

export function toProducerEntries(
  showDates: ProducerShowDateRow[],
  counts: Map<string, DateBookingCounts> | undefined,
): ProducerDateEntry[] {
  return showDates.map((sd) => {
    const slots = showSlots(sd.show);
    const c = counts?.get(sd.id);
    return {
      id: sd.id,
      date: parseDateOnly(sd.date),
      program: sd.show.program ?? '',
      subProgram: sd.show.sub_program,
      venue: sd.venue,
      city: sd.city?.name ?? null,
      session1: sd.session_1,
      session2: sd.session_2,
      session3: sd.session_3,
      status: displayStatus(sd),
      mainSlots: slots?.main_cast ?? 0,
      confirmedMain: c?.confirmedMain ?? 0,
      acceptedMain: c?.acceptedMain ?? 0,
      pendingMain: c?.pendingMain ?? 0,
      understudySlots: slots?.understudies ?? 0,
      confirmedUs: c?.confirmedUs ?? 0,
      custom: sd.custom,
    };
  });
}

/** `−N` cell flag, `N` = the summed main-cast deficit (`mainSlots - confirmedMain`,
 *  floored at 0) across every entry on the day, excluding cancelled dates. `N`
 *  of 0 (nothing short) yields no flag at all. */
function producerFlag(dayEntries: ProducerDateEntry[]): MonthGridCell['flag'] {
  const deficit = dayEntries
    .filter((e) => e.status !== 'cancelled')
    .reduce((sum, e) => sum + Math.max(0, e.mainSlots - e.confirmedMain), 0);
  if (deficit <= 0) return undefined;
  return { text: `−${deficit}`, tone: 'warning' };
}

function chipFor(entry: ProducerDateEntry): MonthGridChip {
  const meter: MeterSegment[] | undefined =
    entry.mainSlots > 0
      ? Array.from({ length: entry.mainSlots }, (_, i) => ({ filled: i < entry.confirmedMain }))
      : undefined;
  return {
    title: entry.program,
    time: entry.session1 ?? undefined,
    tone: PRODUCER_TONES[entry.status].tone,
    meter,
  };
}

export function monthCellsProducer(
  entries: ProducerDateEntry[],
  anchor: Date,
  selectedKey: string,
  rangeKeys: string[],
  today: Date,
): MonthGridCell[] {
  const byKey = new Map<string, ProducerDateEntry[]>();
  for (const e of entries) {
    const key = toDateKey(e.date);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  const rangeSet = new Set(rangeKeys);

  return monthMatrix(anchor).map((day) => {
    if (!day) {
      return { day: null, dayNum: null, isToday: false, isPast: false, isSelected: false, inRange: false, chips: [], moreCount: 0 };
    }
    const key = toDateKey(day);
    const dayEntries = byKey.get(key) ?? [];
    return {
      day,
      dayNum: day.getDate(),
      isToday: key === toDateKey(today),
      isPast: isPastDate(day, today),
      isSelected: key === selectedKey,
      inRange: rangeSet.has(key),
      flag: producerFlag(dayEntries),
      chips: dayEntries.map(chipFor),
      moreCount: 0,
    };
  });
}
