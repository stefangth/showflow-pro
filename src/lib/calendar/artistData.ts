import type { ArtistDateEntry, ArtistStatus, MonthGridCell, MonthGridChip, Tone } from './types';
import type { EligibleDate } from '@/hooks/useArtistEligibleDates';
import { isPastDate, parseDateOnly, toDateKey } from '@/lib/dates';
import { monthMatrix } from './period';

/** The booking-status values that flow straight through to `ArtistStatus` —
 *  the DB `booking_status` enum's non-cancelled states (see the booking
 *  workflow rules: suggested → soft_booked → confirmed). */
const BOOKING_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'soft_booked', 'suggested']);

/** Semantic tone per artist status — mirrors the color intent already encoded
 *  in `ARTIST_TONES`' badge/rail classes (success/warning/primary/destructive/
 *  muted), expressed as the abstract `Tone` a chip carries. */
const ARTIST_STATUS_TONE: Record<ArtistStatus, Tone> = {
  confirmed: 'success',
  soft_booked: 'warning',
  suggested: 'accent',
  blocked: 'destructive',
  unanswered: 'muted',
};

function resolveMyStatus(
  dateId: string,
  dateKey: string,
  statusByDateId: Map<string, { bookingId: string; status: string }>,
  blockedKeys: Set<string>,
): { status: ArtistStatus; bookingId: string | null } {
  const booking = statusByDateId.get(dateId);
  if (booking && BOOKING_STATUSES.has(booking.status)) {
    return { status: booking.status as ArtistStatus, bookingId: booking.bookingId };
  }
  if (blockedKeys.has(dateKey)) {
    return { status: 'blocked', bookingId: null };
  }
  return { status: 'unanswered', bookingId: null };
}

export function toArtistEntries(
  eligible: EligibleDate[],
  statusByDateId: Map<string, { bookingId: string; status: string }>,
  blockedKeys: Set<string>,
  hireOrderByDateId: Map<string, string>,
): ArtistDateEntry[] {
  return eligible.map((ed) => {
    const { status, bookingId } = resolveMyStatus(ed.id, ed.date, statusByDateId, blockedKeys);
    return {
      id: ed.id,
      date: parseDateOnly(ed.date),
      bookingId,
      program: ed.show.program ?? '',
      subProgram: ed.show.sub_program,
      venue: ed.venue,
      // EligibleDate carries only city_id, not a joined city name.
      city: null,
      session1: ed.session_1,
      myStatus: status,
      hireOrderId: hireOrderByDateId.get(ed.id) ?? null,
    };
  });
}

/** Status-only cell flag: 'answer' (accent) nudges toward a pending offer,
 *  'blocked' (destructive) surfaces a self-declared block. Any other status
 *  gets no flag. When a day somehow carries multiple entries, a suggested
 *  offer takes priority over a blocked date. */
function artistFlag(dayEntries: ArtistDateEntry[]): MonthGridCell['flag'] {
  if (dayEntries.some((e) => e.myStatus === 'suggested')) {
    return { text: 'answer', tone: 'accent' };
  }
  if (dayEntries.some((e) => e.myStatus === 'blocked')) {
    return { text: 'blocked', tone: 'destructive' };
  }
  return undefined;
}

function chipFor(entry: ArtistDateEntry): MonthGridChip {
  return {
    title: entry.program,
    time: entry.session1 ?? undefined,
    tone: ARTIST_STATUS_TONE[entry.myStatus],
    // Artist cells are status-only — no fill meter.
  };
}

export function monthCellsArtist(
  entries: ArtistDateEntry[],
  anchor: Date,
  selectedKey: string,
  today: Date,
): MonthGridCell[] {
  const byKey = new Map<string, ArtistDateEntry[]>();
  for (const e of entries) {
    const key = toDateKey(e.date);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }

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
      inRange: false,
      flag: artistFlag(dayEntries),
      chips: dayEntries.map(chipFor),
      moreCount: 0,
    };
  });
}
