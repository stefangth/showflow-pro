import { describe, it, expect } from 'vitest';
import { toWeekModel } from './weekData';
import type { ProducerDateEntry } from './types';

// Deterministic anchor: Fri 14 Aug 2026 → week window is Mon 10 Aug .. Sun 16 Aug.
const ANCHOR = new Date(2026, 7, 14);

function makeEntry(overrides: Partial<ProducerDateEntry> & Pick<ProducerDateEntry, 'id' | 'date'>): ProducerDateEntry {
  return {
    program: 'Aida',
    subProgram: null,
    venue: 'Opera House',
    city: 'Berlin',
    session1: null,
    session2: null,
    session3: null,
    status: 'partially_filled',
    mainSlots: 6,
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

describe('toWeekModel', () => {
  it('positions blocks for timed sessions, buckets all-null-session dates as untimed, and excludes out-of-week entries', () => {
    const timedEntry = makeEntry({
      id: 'sd-timed',
      date: new Date(2026, 7, 12), // Wed 12 Aug — within the week
      session1: '14:00:00',
      session2: '19:30:00',
      mainSlots: 6,
      confirmedMain: 4,
    });
    const untimedEntry = makeEntry({
      id: 'sd-untimed',
      date: new Date(2026, 7, 13), // Thu 13 Aug — within the week
      session1: null,
      session2: null,
      session3: null,
    });
    const outsideEntry = makeEntry({
      id: 'sd-outside',
      date: new Date(2026, 7, 20), // Thu 20 Aug — outside the week
      // 22:00 would widen the band past 20:00 if wrongly included — asserts
      // the band is computed only from entries inside the week window.
      session1: '22:00:00',
    });

    const model = toWeekModel([timedEntry, untimedEntry, outsideEntry], ANCHOR);

    // weekStart / columns
    expect(model.weekStart).toEqual(new Date(2026, 7, 10));
    expect(model.columns).toHaveLength(7);
    expect(model.columns[0]).toEqual(new Date(2026, 7, 10));
    expect(model.columns[6]).toEqual(new Date(2026, 7, 16));

    // blocks: 2 for the timed entry, none for the untimed or out-of-week entries
    expect(model.blocks).toHaveLength(2);

    const block1 = model.blocks.find((b) => b.session === 1);
    const block2 = model.blocks.find((b) => b.session === 2);
    expect(block1).toBeDefined();
    expect(block2).toBeDefined();

    expect(block1).toMatchObject({
      entryId: 'sd-timed',
      columnIndex: 2, // Wed is 2 days after Monday
      startMinutes: 14 * 60,
      title: 'Aida',
      venue: 'Opera House',
      city: 'Berlin',
      status: 'partially_filled',
    });
    expect(block1?.date).toEqual(new Date(2026, 7, 12));
    expect(block1?.meter).toEqual([
      { filled: true }, { filled: true }, { filled: true }, { filled: true },
      { filled: false }, { filled: false },
    ]);

    expect(block2).toMatchObject({
      entryId: 'sd-timed',
      columnIndex: 2,
      startMinutes: 19 * 60 + 30,
    });

    // No block references the out-of-week entry.
    expect(model.blocks.some((b) => b.entryId === 'sd-outside')).toBe(false);

    // untimed: only the all-null-session entry, none of the others.
    expect(model.untimed).toHaveLength(1);
    expect(model.untimed[0]).toMatchObject({
      entryId: 'sd-untimed',
      columnIndex: 3, // Thu is 3 days after Monday
      title: 'Aida',
    });

    // band covers 14:00 (840) .. 20:00 (1200), padded to whole hours, computed
    // only from sessions within the week (excludes sd-outside's 22:00, which
    // would otherwise have widened endMinutes to 1320).
    expect(model.band).toEqual({ startMinutes: 14 * 60, endMinutes: 20 * 60 });
  });

  it('returns empty blocks/untimed and the fallback band when no entries fall in the week', () => {
    const model = toWeekModel([], ANCHOR);
    expect(model.blocks).toEqual([]);
    expect(model.untimed).toEqual([]);
    expect(model.band).toEqual({ startMinutes: 14 * 60, endMinutes: 23 * 60 });
  });
});
