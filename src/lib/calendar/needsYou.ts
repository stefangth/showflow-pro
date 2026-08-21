/**
 * "Needs you" queue — the pure derivation behind Calendar Phase 2's action
 * list (spec §4.1). Buckets each `ProducerDateEntry` into at most one of four
 * groups so a producer sees a single, prioritized worklist instead of
 * re-deriving it from the month grid: a date that's about to lapse, a date
 * that's short on cast, a date ready for its hire order, and a cancellation
 * the cast hasn't been told about yet.
 *
 * No Supabase or React imports here — callers assemble the inputs
 * (`fetchBookingsWithArtistForDates`'s rows, `useDatesReadyForHireOrder`'s
 * `orderByDate` keys) and pass a plain `now` for determinism.
 */
import { differenceInCalendarDays } from 'date-fns';
import type { BookingWithArtistRow } from '@/data/bookings';
import { berlinDateKey, parseDateOnly, toDateKey } from '@/lib/dates';
import { openToOfferSlots } from './slots';
import type { ProducerDateEntry } from './types';

export type NeedsYouGroupKey = 'expires-today' | 'at-risk' | 'ready-to-issue' | 'cancelled';

/** The show_date ids `buildNeedsYouQueue` can actually surface an item for: every
 *  non-cancelled date, plus a cancelled date whose cast has not been notified yet. Shared
 *  by the Dates page and the sidebar badge (`useNeedsYouCount`) so the two derive the same
 *  candidate set from one place and cannot silently drift. */
export function needsYouCandidateDateIds(entries: ProducerDateEntry[]): string[] {
  return entries.filter((e) => e.status !== 'cancelled' || !e.castNotifiedAt).map((e) => e.id);
}

/** Upper bound (in calendar days) on how far out an under-cast date can be
 *  and still land in the `at-risk` group — matches the design mock's
 *  "under-cast inside {RISK_WINDOW} days" group title (mock lines 947-950). */
export const RISK_WINDOW_DAYS = 30;

export interface NeedsYouPerson {
  artistId: string;
  name: string;
  status: BookingWithArtistRow['status'];
  isUnderstudy: boolean;
}

export interface NeedsYouItem {
  dateId: string;
  entry: ProducerDateEntry;
  group: NeedsYouGroupKey;
  people: NeedsYouPerson[];
  /** Non-null only when the item is grouped `expires-today`. */
  earliestExpiry: Date | null;
  /** `mainSlots - (confirmedMain + acceptedMain + pendingMain)`, floored at 0.
   *  Meaningful for `at-risk`; still well-defined (and computed) for every group. */
  openMainSlots: number;
  /** Calendar-day distance from today (Berlin) to `entry.date`; can be negative
   *  for a past date, zero for today. Display only. */
  leadDays: number;
}

export interface NeedsYouGroup {
  key: NeedsYouGroupKey;
  items: NeedsYouItem[];
}

export interface NeedsYouQueue {
  /** Non-empty groups only, in canonical display order (spec §4.1):
   *  expires-today, at-risk, ready-to-issue, cancelled. */
  groups: NeedsYouGroup[];
  totalItems: number;
  countByGroup: Record<NeedsYouGroupKey, number>;
}

/** Display order — also the order groups are emitted in `NeedsYouQueue.groups`.
 *  Exported so callers that render group breakdowns/sections (`QueueRail`,
 *  `NeedsYouLens`) share one canonical order instead of each redeclaring it. */
export const DISPLAY_ORDER: NeedsYouGroupKey[] = ['expires-today', 'at-risk', 'ready-to-issue', 'cancelled'];

/** The toolbar's Needs-you scope-chip selection: a single group key, or
 *  `'all'` for no filter (the default). */
export type NeedsYouScopeKey = 'all' | NeedsYouGroupKey;

/**
 * Filters an already-built `NeedsYouQueue` down to a single group for the
 * toolbar's scope-chip row — a pure slice of the groups already computed by
 * `buildNeedsYouQueue`, no re-derivation or data fetch. `totalItems` and
 * `countByGroup` are left untouched so a chip row can keep showing the full
 * breakdown (each chip's live count) even while the queue body only renders
 * the selected group. `scope === 'all'` returns `queue` unchanged.
 */
export function filterNeedsYouQueueByScope(queue: NeedsYouQueue, scope: NeedsYouScopeKey): NeedsYouQueue {
  if (scope === 'all') return queue;
  return { ...queue, groups: queue.groups.filter((group) => group.key === scope) };
}

function toPerson(row: BookingWithArtistRow): NeedsYouPerson | null {
  if (!row.artist) return null;
  return { artistId: row.artist.id, name: row.artist.name, status: row.status, isUnderstudy: row.isUnderstudy };
}

/** Earliest non-null `offerExpiresAt` among `rows` whose Berlin calendar date is
 *  `todayKey`, restricted to still-live offer statuses (`suggested`/`soft_booked`).
 *  `null` when none match — the entry doesn't belong in `expires-today`. */
function earliestExpiryToday(rows: BookingWithArtistRow[], todayKey: string): Date | null {
  let earliest: Date | null = null;
  for (const row of rows) {
    if (row.status !== 'suggested' && row.status !== 'soft_booked') continue;
    if (!row.offerExpiresAt) continue;
    const expiry = new Date(row.offerExpiresAt);
    if (berlinDateKey(expiry) !== todayKey) continue;
    if (earliest === null || expiry < earliest) earliest = expiry;
  }
  return earliest;
}

function classify(args: {
  entry: ProducerDateEntry;
  earliestExpiry: Date | null;
  readyIds: Set<string>;
  todayKey: string;
  todayLocal: Date;
}): NeedsYouGroupKey | null {
  const { entry, earliestExpiry, readyIds, todayKey, todayLocal } = args;
  const isCancelled = entry.status === 'cancelled';

  // 1. cancelled — priority-first so a cancelled+unnotified date that also
  //    satisfies a later rule (e.g. it's in readyIds) still dedupes here.
  if (isCancelled && entry.castNotifiedAt == null) return 'cancelled';

  // 2. expires-today — non-cancelled dates only.
  if (!isCancelled && earliestExpiry !== null) return 'expires-today';

  // 3. ready-to-issue — membership only, per the brief (a cancelled-but-notified
  //    date that's still in readyIds falls through to here).
  if (readyIds.has(entry.id)) return 'ready-to-issue';

  // 4. at-risk — non-cancelled, future-or-today (Berlin), understaffed, and
  //    inside the RISK_WINDOW_DAYS window (design mock's "under-cast inside
  //    30 days" group title) — an understaffed date further out than that
  //    isn't urgent enough yet to surface in the queue.
  if (
    !isCancelled &&
    toDateKey(entry.date) >= todayKey &&
    entry.mainSlots > 0 &&
    openToOfferSlots(entry) > 0 &&
    differenceInCalendarDays(entry.date, todayLocal) <= RISK_WINDOW_DAYS
  ) {
    return 'at-risk';
  }

  return null;
}

export function buildNeedsYouQueue(args: {
  entries: ProducerDateEntry[];
  people: BookingWithArtistRow[];
  readyIds: Set<string>;
  now: Date;
}): NeedsYouQueue {
  const { entries, people, readyIds, now } = args;

  const peopleByDate = new Map<string, BookingWithArtistRow[]>();
  for (const row of people) {
    const list = peopleByDate.get(row.showDateId) ?? [];
    list.push(row);
    peopleByDate.set(row.showDateId, list);
  }

  const todayKey = berlinDateKey(now);
  const todayLocal = parseDateOnly(todayKey);

  const buckets: Record<NeedsYouGroupKey, NeedsYouItem[]> = {
    'expires-today': [],
    'at-risk': [],
    'ready-to-issue': [],
    cancelled: [],
  };

  for (const entry of entries) {
    const rows = peopleByDate.get(entry.id) ?? [];
    const earliestExpiry = earliestExpiryToday(rows, todayKey);
    const group = classify({ entry, earliestExpiry, readyIds, todayKey, todayLocal });
    if (!group) continue;

    const peopleOut = rows
      .map(toPerson)
      .filter((p): p is NeedsYouPerson => p !== null);
    const openMainSlots = openToOfferSlots(entry);
    const leadDays = differenceInCalendarDays(entry.date, todayLocal);

    buckets[group].push({
      dateId: entry.id,
      entry,
      group,
      people: peopleOut,
      earliestExpiry,
      openMainSlots,
      leadDays,
    });
  }

  const groups = DISPLAY_ORDER
    .map((key): NeedsYouGroup => ({ key, items: buckets[key] }))
    .filter((g) => g.items.length > 0);

  const countByGroup = DISPLAY_ORDER.reduce((acc, key) => {
    acc[key] = buckets[key].length;
    return acc;
  }, {} as Record<NeedsYouGroupKey, number>);

  const totalItems = DISPLAY_ORDER.reduce((sum, key) => sum + buckets[key].length, 0);

  return { groups, totalItems, countByGroup };
}
