import { describe, it, expect } from 'vitest';
import { toProducerEntries, type ProducerShowDateRow } from './producerData';
import { monthCellsProducer } from './producerData';
import type { DateBookingCounts } from '@/data/bookings';
import { toDateKey } from '@/lib/dates';

const rows: ProducerShowDateRow[] = [
  {
    id: 'sd1',
    date: '2026-08-18',
    session_1: '19:00',
    session_2: null,
    session_3: null,
    venue: 'Opera House',
    status: 'partially_filled',
    notes: null,
    city_id: 'c1',
    show_id: 'show1',
    custom: null,
    show: {
      program: 'Aida',
      sub_program: null,
      status: 'active',
      main_cast_slots: 6,
      understudy_slots: 2,
    },
    city: { name: 'Berlin' },
  },
  {
    id: 'sd2',
    date: '2026-08-19',
    session_1: null,
    session_2: null,
    session_3: null,
    venue: null,
    status: 'open',
    notes: null,
    city_id: null,
    show_id: 'show2',
    custom: null,
    show: {
      program: 'Rigoletto',
      sub_program: null,
      status: 'active',
      main_cast_slots: null,
      understudy_slots: null,
    },
    city: null,
  },
];

const counts = new Map<string, DateBookingCounts>([
  [
    'sd1',
    {
      confirmedMain: 4,
      confirmedUs: 1,
      acceptedMain: 1,
      acceptedUs: 0,
      pendingMain: 1,
      pendingUs: 0,
      total: 6,
    },
  ],
]);

describe('producerData', () => {
  describe('toProducerEntries', () => {
    it('derives status/slots/counts for a partially-filled date', () => {
      const entries = toProducerEntries(rows, counts);
      const sd1 = entries.find((e) => e.id === 'sd1')!;
      expect(sd1.status).toBe('partially_filled');
      expect(sd1.mainSlots).toBe(6);
      expect(sd1.confirmedMain).toBe(4);
      expect(sd1.understudySlots).toBe(2);
      expect(sd1.program).toBe('Aida');
      expect(sd1.city).toBe('Berlin');
    });

    it('falls back to unconfigured for an open date with no slot config', () => {
      const entries = toProducerEntries(rows, counts);
      const sd2 = entries.find((e) => e.id === 'sd2')!;
      expect(sd2.status).toBe('unconfigured');
      expect(sd2.mainSlots).toBe(0);
      expect(sd2.confirmedMain).toBe(0);
    });

    it('zero-fills counts when the counts map has no entry for a date', () => {
      const entries = toProducerEntries(rows, undefined);
      const sd1 = entries.find((e) => e.id === 'sd1')!;
      expect(sd1.confirmedMain).toBe(0);
    });
  });

  describe('monthCellsProducer', () => {
    it('places a deficit flag and a fill meter on the matrix cell for a partially-filled date', () => {
      const entries = toProducerEntries(rows, counts);
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsProducer(entries, anchor, '', [], today);

      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-18');
      expect(cell).toBeDefined();
      expect(cell!.flag?.text).toBe('−2');
      expect(cell!.flag?.tone).toBe('warning');
      expect(cell!.chips).toHaveLength(1);
      expect(cell!.chips[0].title).toBe('Aida');
      expect(cell!.chips[0].time).toBe('19:00');
      expect(cell!.chips[0].meter).toHaveLength(6);
      expect(cell!.chips[0].meter?.filter((m) => m.filled)).toHaveLength(4);
    });

    it('places no flag on a fully-filled date', () => {
      const fullyFilledRow: ProducerShowDateRow = {
        ...rows[0],
        id: 'sd3',
        date: '2026-08-20',
        status: 'fully_filled',
      };
      const fullCounts = new Map<string, DateBookingCounts>([
        [
          'sd3',
          {
            confirmedMain: 6,
            confirmedUs: 2,
            acceptedMain: 0,
            acceptedUs: 0,
            pendingMain: 0,
            pendingUs: 0,
            total: 6,
          },
        ],
      ]);
      const entries = toProducerEntries([fullyFilledRow], fullCounts);
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsProducer(entries, anchor, '', [], today);
      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-20');
      expect(cell!.flag).toBeUndefined();
    });

    it('always returns a fixed 42-cell grid with null padding cells', () => {
      const cells = monthCellsProducer([], new Date(2026, 7, 1), '', [], new Date(2026, 7, 15));
      expect(cells).toHaveLength(42);
      expect(cells[0].day).toBeNull();
      expect(cells[0].chips).toEqual([]);
    });

    it('marks isSelected/isToday/inRange from the given keys', () => {
      const entries = toProducerEntries(rows, counts);
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 18);
      const cells = monthCellsProducer(entries, anchor, '2026-08-19', ['2026-08-19'], today);
      const cell18 = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-18')!;
      const cell19 = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-19')!;
      expect(cell18.isToday).toBe(true);
      expect(cell19.isSelected).toBe(true);
      expect(cell19.inRange).toBe(true);
      expect(cell18.inRange).toBe(false);
    });
  });
});
