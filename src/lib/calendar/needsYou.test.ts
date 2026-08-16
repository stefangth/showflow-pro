import { describe, it, expect } from 'vitest';
import { buildNeedsYouQueue, filterNeedsYouQueueByScope, RISK_WINDOW_DAYS } from './needsYou';
import type { NeedsYouQueue } from './needsYou';
import type { ProducerDateEntry } from './types';
import type { BookingWithArtistRow } from '@/data/bookings';

// Deterministic "now": 15 Aug 2026, 12:00 local. The suite's local timezone is
// Europe/Berlin (matches the booking engine's anchor), so this is safely
// mid-day in Berlin regardless of any CI runner TZ offset.
const NOW = new Date(2026, 7, 15, 12, 0);

function makeEntry(overrides: Partial<ProducerDateEntry> & Pick<ProducerDateEntry, 'id' | 'date'>): ProducerDateEntry {
  return {
    program: 'Aida',
    subProgram: null,
    venue: 'Opera House',
    city: 'Berlin',
    session1: '19:00',
    session2: null,
    session3: null,
    status: 'partially_filled',
    mainSlots: 4,
    confirmedMain: 4,
    acceptedMain: 0,
    pendingMain: 0,
    understudySlots: 0,
    confirmedUs: 0,
    custom: null,
    hireOrderId: null,
    hireOrderStatus: null,
    castNotifiedAt: null,
    ...overrides,
  };
}

function makePerson(overrides: Partial<BookingWithArtistRow> & Pick<BookingWithArtistRow, 'id' | 'showDateId'>): BookingWithArtistRow {
  return {
    status: 'suggested',
    isUnderstudy: false,
    offerExpiresAt: null,
    artist: { id: 'artist-1', name: 'Ada Lovelace' },
    ...overrides,
  };
}

describe('buildNeedsYouQueue', () => {
  it('buckets four dates into their groups, in display order, one bucket each', () => {
    const cancelledEntry = makeEntry({
      id: 'd-cancelled',
      date: new Date(2026, 7, 20),
      status: 'cancelled',
      castNotifiedAt: null,
      mainSlots: 4,
      confirmedMain: 0,
      acceptedMain: 0,
      pendingMain: 0,
    });

    const expiresTodayEntry = makeEntry({
      id: 'd-expires',
      date: new Date(2026, 7, 22),
      status: 'open',
      mainSlots: 4,
      confirmedMain: 4,
    });

    const readyEntry = makeEntry({
      id: 'd-ready',
      date: new Date(2026, 7, 18),
      status: 'fully_filled',
      mainSlots: 4,
      confirmedMain: 4,
    });

    const atRiskEntry = makeEntry({
      id: 'd-atrisk',
      date: new Date(2026, 7, 20),
      status: 'partially_filled',
      mainSlots: 5,
      confirmedMain: 2,
      acceptedMain: 1,
      pendingMain: 0,
    });

    const entries = [cancelledEntry, expiresTodayEntry, readyEntry, atRiskEntry];

    const people: BookingWithArtistRow[] = [
      // Expiring today (Berlin): 2026-08-15T10:00:00Z = 12:00 CEST, still 15 Aug in Berlin.
      makePerson({
        id: 'b1',
        showDateId: 'd-expires',
        status: 'suggested',
        offerExpiresAt: '2026-08-15T10:00:00.000Z',
        artist: { id: 'artist-2', name: 'Marie Curie' },
      }),
      // A second offer on the same date, expiring tomorrow (Berlin) — must NOT
      // count toward "expires today", and must not win over the earlier one.
      makePerson({
        id: 'b2',
        showDateId: 'd-expires',
        status: 'suggested',
        offerExpiresAt: '2026-08-16T10:00:00.000Z',
        artist: { id: 'artist-3', name: 'Rosalind Franklin' },
      }),
      // Confirmed cast on the at-risk date — not enough to fill mainSlots=5.
      makePerson({
        id: 'b3',
        showDateId: 'd-atrisk',
        status: 'confirmed',
        artist: { id: 'artist-4', name: 'Grace Hopper' },
      }),
    ];

    const readyIds = new Set(['d-ready']);

    const queue = buildNeedsYouQueue({ entries, people, readyIds, now: NOW });

    expect(queue.groups.map((g) => g.key)).toEqual(['expires-today', 'at-risk', 'ready-to-issue', 'cancelled']);
    expect(queue.totalItems).toBe(4);
    expect(queue.countByGroup).toEqual({
      'expires-today': 1,
      'at-risk': 1,
      'ready-to-issue': 1,
      cancelled: 1,
    });

    const expiresGroup = queue.groups.find((g) => g.key === 'expires-today')!;
    expect(expiresGroup.items).toHaveLength(1);
    expect(expiresGroup.items[0].dateId).toBe('d-expires');
    expect(expiresGroup.items[0].earliestExpiry).toEqual(new Date('2026-08-15T10:00:00.000Z'));
    expect(expiresGroup.items[0].people.map((p) => p.artistId).sort()).toEqual(['artist-2', 'artist-3']);

    const atRiskGroup = queue.groups.find((g) => g.key === 'at-risk')!;
    expect(atRiskGroup.items).toHaveLength(1);
    expect(atRiskGroup.items[0].dateId).toBe('d-atrisk');
    // mainSlots(5) - (confirmed 2 + accepted 1 + pending 0) = 2.
    expect(atRiskGroup.items[0].openMainSlots).toBe(2);

    const readyGroup = queue.groups.find((g) => g.key === 'ready-to-issue')!;
    expect(readyGroup.items).toHaveLength(1);
    expect(readyGroup.items[0].dateId).toBe('d-ready');

    const cancelledGroup = queue.groups.find((g) => g.key === 'cancelled')!;
    expect(cancelledGroup.items).toHaveLength(1);
    expect(cancelledGroup.items[0].dateId).toBe('d-cancelled');
  });

  it('dedups a cancelled+unnotified date that is also readyIds-eligible into cancelled only', () => {
    const dedupEntry = makeEntry({
      id: 'd-dedup',
      date: new Date(2026, 7, 20),
      status: 'cancelled',
      castNotifiedAt: null,
      mainSlots: 4,
      confirmedMain: 4,
    });

    const queue = buildNeedsYouQueue({
      entries: [dedupEntry],
      people: [],
      readyIds: new Set(['d-dedup']),
      now: NOW,
    });

    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0].key).toBe('cancelled');
    expect(queue.groups[0].items.map((i) => i.dateId)).toEqual(['d-dedup']);
    expect(queue.totalItems).toBe(1);
    expect(queue.countByGroup['ready-to-issue']).toBe(0);
    expect(queue.countByGroup.cancelled).toBe(1);
  });

  it('drops a date that matches no group (e.g. cancelled-but-notified, not ready, not at-risk)', () => {
    const notifiedCancelled = makeEntry({
      id: 'd-notified',
      date: new Date(2026, 7, 20),
      status: 'cancelled',
      castNotifiedAt: '2026-08-10T09:00:00.000Z',
      mainSlots: 4,
      confirmedMain: 4,
    });

    const queue = buildNeedsYouQueue({
      entries: [notifiedCancelled],
      people: [],
      readyIds: new Set(),
      now: NOW,
    });

    expect(queue.groups).toHaveLength(0);
    expect(queue.totalItems).toBe(0);
    expect(queue.countByGroup).toEqual({
      'expires-today': 0,
      'at-risk': 0,
      'ready-to-issue': 0,
      cancelled: 0,
    });
  });

  it('computes leadDays as the calendar-day distance from today (Berlin) to the entry date', () => {
    const atRiskEntry = makeEntry({
      id: 'd-lead',
      date: new Date(2026, 7, 18), // 3 days after NOW's 15 Aug
      status: 'open',
      mainSlots: 2,
      confirmedMain: 0,
      acceptedMain: 0,
      pendingMain: 0,
    });

    const queue = buildNeedsYouQueue({ entries: [atRiskEntry], people: [], readyIds: new Set(), now: NOW });

    expect(queue.groups[0].items[0].leadDays).toBe(3);
  });

  it('excludes a past date from at-risk even when understaffed', () => {
    const pastEntry = makeEntry({
      id: 'd-past',
      date: new Date(2026, 7, 10), // before NOW's 15 Aug
      status: 'open',
      mainSlots: 2,
      confirmedMain: 0,
      acceptedMain: 0,
      pendingMain: 0,
    });

    const queue = buildNeedsYouQueue({ entries: [pastEntry], people: [], readyIds: new Set(), now: NOW });

    expect(queue.groups).toHaveLength(0);
    expect(queue.totalItems).toBe(0);
  });

  it('includes an under-cast date exactly RISK_WINDOW_DAYS out as at-risk', () => {
    const boundaryEntry = makeEntry({
      id: 'd-boundary',
      date: new Date(2026, 7, 15 + RISK_WINDOW_DAYS), // exactly 30 days after NOW's 15 Aug
      status: 'open',
      mainSlots: 2,
      confirmedMain: 0,
      acceptedMain: 0,
      pendingMain: 0,
    });

    const queue = buildNeedsYouQueue({ entries: [boundaryEntry], people: [], readyIds: new Set(), now: NOW });

    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0].key).toBe('at-risk');
    expect(queue.groups[0].items[0].dateId).toBe('d-boundary');
  });

  it('excludes an under-cast date RISK_WINDOW_DAYS + 1 out from at-risk', () => {
    const beyondWindowEntry = makeEntry({
      id: 'd-beyond',
      date: new Date(2026, 7, 15 + RISK_WINDOW_DAYS + 1), // 31 days after NOW's 15 Aug
      status: 'open',
      mainSlots: 2,
      confirmedMain: 0,
      acceptedMain: 0,
      pendingMain: 0,
    });

    const queue = buildNeedsYouQueue({ entries: [beyondWindowEntry], people: [], readyIds: new Set(), now: NOW });

    expect(queue.groups).toHaveLength(0);
    expect(queue.totalItems).toBe(0);
  });
});

describe('filterNeedsYouQueueByScope', () => {
  function sampleQueue(): NeedsYouQueue {
    const atRiskEntry = makeEntry({ id: 'd-at-risk', date: new Date(2026, 7, 18), status: 'open', mainSlots: 2 });
    const cancelledEntry = makeEntry({ id: 'd-cancelled', date: new Date(2026, 7, 20), status: 'cancelled' });
    return {
      groups: [
        { key: 'at-risk', items: [{ dateId: 'd-at-risk', entry: atRiskEntry, group: 'at-risk', people: [], earliestExpiry: null, openMainSlots: 2, leadDays: 3 }] },
        { key: 'cancelled', items: [{ dateId: 'd-cancelled', entry: cancelledEntry, group: 'cancelled', people: [], earliestExpiry: null, openMainSlots: 0, leadDays: 5 }] },
      ],
      totalItems: 2,
      countByGroup: { 'expires-today': 0, 'at-risk': 1, 'ready-to-issue': 0, cancelled: 1 },
    };
  }

  it('"all" returns the queue unchanged', () => {
    const queue = sampleQueue();
    expect(filterNeedsYouQueueByScope(queue, 'all')).toBe(queue);
  });

  it('a group key narrows groups to just that group, leaving totals/counts untouched', () => {
    const queue = sampleQueue();
    const filtered = filterNeedsYouQueueByScope(queue, 'cancelled');

    expect(filtered.groups).toHaveLength(1);
    expect(filtered.groups[0].key).toBe('cancelled');
    // Counts/totals stay at the full breakdown so a chip row built from them
    // keeps showing every category's live count, not just the visible one.
    expect(filtered.totalItems).toBe(2);
    expect(filtered.countByGroup).toEqual(queue.countByGroup);
  });

  it('a group key with no items in the queue narrows to an empty group list', () => {
    const queue = sampleQueue();
    const filtered = filterNeedsYouQueueByScope(queue, 'ready-to-issue');
    expect(filtered.groups).toHaveLength(0);
  });
});
