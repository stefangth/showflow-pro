import { describe, it, expect } from 'vitest';
import { toArtistEntries, monthCellsArtist } from './artistData';
import type { EligibleDate } from '@/hooks/useArtistEligibleDates';
import { toDateKey } from '@/lib/dates';

const eligible: EligibleDate[] = [
  {
    id: 'sd1',
    date: '2026-08-18',
    session_1: '19:00',
    session_2: null,
    session_3: null,
    status: 'open',
    city_id: null,
    show_id: 'show1',
    venue: 'Opera House',
    city: 'Berlin',
    custom: null,
    show: { id: 'show1', program: 'Aida', sub_program: null, status: 'active' },
  },
  {
    id: 'sd2',
    date: '2026-08-19',
    session_1: null,
    session_2: null,
    session_3: null,
    status: 'open',
    city_id: null,
    show_id: 'show2',
    venue: null,
    city: null,
    custom: null,
    show: { id: 'show2', program: 'Rigoletto', sub_program: null, status: 'active' },
  },
  {
    id: 'sd3',
    date: '2026-08-20',
    session_1: null,
    session_2: null,
    session_3: null,
    status: 'open',
    city_id: null,
    show_id: 'show3',
    venue: null,
    city: null,
    custom: null,
    show: { id: 'show3', program: 'Nabucco', sub_program: null, status: 'active' },
  },
];

describe('artistData', () => {
  describe('toArtistEntries', () => {
    it('derives myStatus from the booking status when one exists', () => {
      const statusByDateId = new Map([['sd1', { bookingId: 'b1', status: 'suggested' }]]);
      const entries = toArtistEntries(eligible, statusByDateId, new Set(), new Map());
      const sd1 = entries.find((e) => e.id === 'sd1')!;
      expect(sd1.myStatus).toBe('suggested');
      expect(sd1.bookingId).toBe('b1');
    });

    it('falls back to blocked when the date is in blockedKeys and there is no booking', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(['2026-08-19']), new Map());
      const sd2 = entries.find((e) => e.id === 'sd2')!;
      expect(sd2.myStatus).toBe('blocked');
      expect(sd2.bookingId).toBeNull();
    });

    it('falls back to unanswered when there is no booking and the date is not blocked', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(), new Map());
      const sd3 = entries.find((e) => e.id === 'sd3')!;
      expect(sd3.myStatus).toBe('unanswered');
    });

    it('carries the hire-order id through when present', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(), new Map([['sd1', 'ho1']]));
      const sd1 = entries.find((e) => e.id === 'sd1')!;
      expect(sd1.hireOrderId).toBe('ho1');
      const sd2 = entries.find((e) => e.id === 'sd2')!;
      expect(sd2.hireOrderId).toBeNull();
    });

    it('populates city from the eligible date\'s joined city name', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(), new Map());
      const sd1 = entries.find((e) => e.id === 'sd1')!;
      expect(sd1.city).toBe('Berlin');
      const sd2 = entries.find((e) => e.id === 'sd2')!;
      expect(sd2.city).toBeNull();
    });
  });

  describe('monthCellsArtist', () => {
    it('renders a status-only chip (no meter) and an "answer" flag for a suggested offer', () => {
      const statusByDateId = new Map([['sd1', { bookingId: 'b1', status: 'suggested' }]]);
      const entries = toArtistEntries(eligible, statusByDateId, new Set(), new Map());
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsArtist(entries, anchor, '', today);

      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-18');
      expect(cell).toBeDefined();
      expect(cell!.chips).toHaveLength(1);
      expect(cell!.chips[0].title).toBe('Aida');
      // 'accent' is the abstract Tone matching ARTIST_TONES.suggested's primary color.
      expect(cell!.chips[0].tone).toBe('accent');
      expect(cell!.chips[0].meter).toBeUndefined();
      expect(cell!.flag?.text).toBe('answer');
      expect(cell!.flag?.tone).toBe('accent');
    });

    it('renders a "blocked" flag with destructive tone for a blocked date', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(['2026-08-19']), new Map());
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsArtist(entries, anchor, '', today);
      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-19');
      expect(cell!.flag?.text).toBe('blocked');
      expect(cell!.flag?.tone).toBe('destructive');
      expect(cell!.chips[0].tone).toBe('destructive');
    });

    it('renders no flag for an unanswered date', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(), new Map());
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsArtist(entries, anchor, '', today);
      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-20');
      expect(cell!.flag).toBeUndefined();
      expect(cell!.chips[0].tone).toBe('muted');
    });

    it('prefers the "answer" flag over "blocked" when a day has both a suggested and a blocked entry', () => {
        const sameDayEligible: EligibleDate[] = [
        {
          id: 'sd-suggested',
          date: '2026-08-22',
          session_1: '19:00',
          session_2: null,
          session_3: null,
          status: 'open',
          city_id: null,
          show_id: 'show-a',
          venue: null,
          city: null,
          custom: null,
          show: { id: 'show-a', program: 'Aida', sub_program: null, status: 'active' },
        },
        {
          id: 'sd-blocked',
          date: '2026-08-22',
          session_1: null,
          session_2: null,
          session_3: null,
          status: 'open',
          city_id: null,
          show_id: 'show-b',
          venue: null,
          city: null,
          custom: null,
          show: { id: 'show-b', program: 'Rigoletto', sub_program: null, status: 'active' },
        },
      ];
      const statusByDateId = new Map([['sd-suggested', { bookingId: 'b1', status: 'suggested' }]]);
      const blockedKeys = new Set(['2026-08-22']);
      const entries = toArtistEntries(sameDayEligible, statusByDateId, blockedKeys, new Map());
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsArtist(entries, anchor, '', today);
      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-22');
      expect(cell!.flag?.text).toBe('answer');
      expect(cell!.flag?.tone).toBe('accent');
      expect(cell!.chips).toHaveLength(2);
    });

    it('always returns a fixed 42-cell grid with null padding cells', () => {
      const cells = monthCellsArtist([], new Date(2026, 7, 1), '', new Date(2026, 7, 15));
      expect(cells).toHaveLength(42);
      expect(cells[0].day).toBeNull();
      expect(cells[0].chips).toEqual([]);
    });

    it('reports overflow count when a day has more than 2 entries, without dropping any chips', () => {
      const sameDayEligible: EligibleDate[] = [
        {
          id: 'sd-x', date: '2026-08-23', session_1: null, session_2: null, session_3: null,
          status: 'open', city_id: null, show_id: 'show-x', venue: null, city: null, custom: null,
          show: { id: 'show-x', program: 'Show X', sub_program: null, status: 'active' },
        },
        {
          id: 'sd-y', date: '2026-08-23', session_1: null, session_2: null, session_3: null,
          status: 'open', city_id: null, show_id: 'show-y', venue: null, city: null, custom: null,
          show: { id: 'show-y', program: 'Show Y', sub_program: null, status: 'active' },
        },
        {
          id: 'sd-z', date: '2026-08-23', session_1: null, session_2: null, session_3: null,
          status: 'open', city_id: null, show_id: 'show-z', venue: null, city: null, custom: null,
          show: { id: 'show-z', program: 'Show Z', sub_program: null, status: 'active' },
        },
      ];
      const entries = toArtistEntries(sameDayEligible, new Map(), new Set(), new Map());
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 15);
      const cells = monthCellsArtist(entries, anchor, '', today);
      const cell = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-23');
      expect(cell!.chips).toHaveLength(3);
      expect(cell!.moreCount).toBe(1);
    });

    it('marks isSelected/isToday from the given keys, and always leaves inRange false', () => {
      const entries = toArtistEntries(eligible, new Map(), new Set(), new Map());
      const anchor = new Date(2026, 7, 1);
      const today = new Date(2026, 7, 18);
      const cells = monthCellsArtist(entries, anchor, '2026-08-19', today);
      const cell18 = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-18')!;
      const cell19 = cells.find((c) => c.day && toDateKey(c.day) === '2026-08-19')!;
      expect(cell18.isToday).toBe(true);
      expect(cell19.isSelected).toBe(true);
      expect(cell19.inRange).toBe(false);
      expect(cell18.inRange).toBe(false);
    });
  });
});
