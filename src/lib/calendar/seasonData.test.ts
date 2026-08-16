import { describe, it, expect } from 'vitest';
import { toSeasonModel, seasonKpis } from './seasonData';
import type { ProducerDateEntry } from './types';

// Deterministic anchor: Fri 14 Aug 2026 → season window is
// periodWindow(anchor,'season') = Sat 1 Aug 2026 .. Sat 31 Oct 2026
// (startOfMonth(anchor) through endOfMonth(anchor+2 months)).
const ANCHOR = new Date(2026, 7, 14);
const WINDOW_START = new Date(2026, 7, 1);

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

describe('toSeasonModel', () => {
  it('groups entries into one row per showId, positions cells by day, and sums open slots into loadByDay', () => {
    // Show A has two dates (week of Mon 3 Aug), show B has one date (same
    // week). A third show-A date sits in a later week (Mon 10 Aug) so the
    // model spans 2 distinct Mon-weeks, as the brief requires.
    const a1 = makeEntry({
      id: 'sd-a1',
      showId: 'show-a',
      date: new Date(2026, 7, 4), // Tue 4 Aug — week of Mon 3 Aug
      program: 'Aida',
      subProgram: 'Matinee',
      mainSlots: 4,
      confirmedMain: 3,
      status: 'partially_filled',
    });
    const b1 = makeEntry({
      id: 'sd-b1',
      showId: 'show-b',
      date: new Date(2026, 7, 6), // Thu 6 Aug — same week as a1
      program: 'Carmen',
      subProgram: null,
      mainSlots: 5,
      confirmedMain: 5,
      status: 'fully_filled',
    });
    const a2 = makeEntry({
      id: 'sd-a2',
      showId: 'show-a',
      date: new Date(2026, 7, 12), // Wed 12 Aug — week of Mon 10 Aug
      program: 'Aida',
      subProgram: 'Matinee',
      mainSlots: 3,
      confirmedMain: 1,
      status: 'partially_filled',
    });

    const model = toSeasonModel([a1, b1, a2], ANCHOR);

    // days: window is Sat 1 Aug .. Sat 31 Oct 2026 (92 days), Mon-first-agnostic
    // day-by-day list starting exactly at periodWindow's start.
    expect(model.days[0]).toEqual(WINDOW_START);
    expect(model.days).toHaveLength(92);
    expect(model.days[model.days.length - 1]).toEqual(new Date(2026, 9, 31));

    // rows: exactly 2, keyed by showId (not by program, even though a1/a2
    // share a program+subProgram pair with each other and could in principle
    // collide with a different show using the same pair).
    expect(model.rows).toHaveLength(2);
    const rowA = model.rows.find((r) => r.showId === 'show-a');
    const rowB = model.rows.find((r) => r.showId === 'show-b');
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA?.label).toBe('Aida · Matinee');
    expect(rowB?.label).toBe('Carmen');

    // cells: one per day, aligned to `days`, positioned via calendar-day offset.
    expect(rowA?.cells).toHaveLength(92);
    const idxA1 = 3; // Tue 4 Aug is 3 days after Sat 1 Aug
    const idxA2 = 11; // Wed 12 Aug is 11 days after Sat 1 Aug
    const idxB1 = 5; // Thu 6 Aug is 5 days after Sat 1 Aug

    expect(rowA?.cells[idxA1]).toMatchObject({
      dateId: 'sd-a1',
      filledMain: 3,
      mainSlots: 4,
      status: 'partially_filled',
      intensity: 0.75,
    });
    expect(rowA?.cells[idxA1].date).toEqual(new Date(2026, 7, 4));
    expect(rowA?.cells[idxA2]).toMatchObject({
      dateId: 'sd-a2',
      filledMain: 1,
      mainSlots: 3,
      status: 'partially_filled',
      intensity: 1 / 3,
    });
    // Every other cell in row A is the "no date" placeholder.
    expect(rowA?.cells[0]).toMatchObject({ dateId: null, filledMain: 0, mainSlots: 0, status: null, intensity: 0 });

    expect(rowB?.cells[idxB1]).toMatchObject({
      dateId: 'sd-b1',
      filledMain: 5,
      mainSlots: 5,
      status: 'fully_filled',
      intensity: 1,
    });

    // loadByDay: per-day sum of open main slots (mainSlots - filledMain)
    // across rows. Day idxA1 has only a1 open by 1; idxB1 has b1 open by 0;
    // idxA2 has only a2 open by 2; every other day is 0 (no dates).
    expect(model.loadByDay).toHaveLength(92);
    expect(model.loadByDay[idxA1]).toEqual({ date: new Date(2026, 7, 4), openMainSlots: 1 });
    expect(model.loadByDay[idxB1]).toEqual({ date: new Date(2026, 7, 6), openMainSlots: 0 });
    expect(model.loadByDay[idxA2]).toEqual({ date: new Date(2026, 7, 12), openMainSlots: 2 });
    expect(model.loadByDay[0]).toEqual({ date: WINDOW_START, openMainSlots: 0 });
  });

  it('excludes entries outside the season window', () => {
    const outside = makeEntry({
      id: 'sd-outside',
      showId: 'show-x',
      date: new Date(2026, 10, 5), // 5 Nov — after the Oct 31 window end
    });
    const model = toSeasonModel([outside], ANCHOR);
    expect(model.rows).toHaveLength(0);
  });

  describe('row label rule', () => {
    it('joins program and sub_program with a middot when both present', () => {
      const entry = makeEntry({ id: 'sd-1', showId: 'show-1', date: new Date(2026, 7, 5), program: 'Aida', subProgram: 'Matinee' });
      const model = toSeasonModel([entry], ANCHOR);
      expect(model.rows[0].label).toBe('Aida · Matinee');
    });

    it('falls back to program alone when sub_program is null', () => {
      const entry = makeEntry({ id: 'sd-2', showId: 'show-2', date: new Date(2026, 7, 5), program: 'Aida', subProgram: null });
      const model = toSeasonModel([entry], ANCHOR);
      expect(model.rows[0].label).toBe('Aida');
    });

    it('falls back to sub_program alone when program is blank', () => {
      const entry = makeEntry({ id: 'sd-3', showId: 'show-3', date: new Date(2026, 7, 5), program: '', subProgram: 'Gala Night' });
      const model = toSeasonModel([entry], ANCHOR);
      expect(model.rows[0].label).toBe('Gala Night');
    });

    it('falls back to venue when program and sub_program are both blank', () => {
      const entry = makeEntry({ id: 'sd-4', showId: 'show-4', date: new Date(2026, 7, 5), program: '', subProgram: null, venue: 'Community Hall' });
      const model = toSeasonModel([entry], ANCHOR);
      expect(model.rows[0].label).toBe('Community Hall');
    });

    it('falls back to a blank label (component renders the localized Untitled fallback) when program, sub_program, and venue are all blank', () => {
      const entry = makeEntry({ id: 'sd-5', showId: 'show-5', date: new Date(2026, 7, 5), program: '', subProgram: null, venue: null });
      const model = toSeasonModel([entry], ANCHOR);
      expect(model.rows[0].label).toBe('');
    });

    it('keys rows by showId, not by program, so two shows sharing a program+sub_program pair stay separate rows', () => {
      const e1 = makeEntry({ id: 'sd-6', showId: 'show-6', date: new Date(2026, 7, 5), program: 'Aida', subProgram: 'Matinee' });
      const e2 = makeEntry({ id: 'sd-7', showId: 'show-7', date: new Date(2026, 7, 5), program: 'Aida', subProgram: 'Matinee' });
      const model = toSeasonModel([e1, e2], ANCHOR);
      expect(model.rows).toHaveLength(2);
      expect(model.rows.map((r) => r.showId).sort()).toEqual(['show-6', 'show-7']);
    });

    it('falls back to id when showId is absent, keeping legacy fixtures compiling and grouping correctly', () => {
      const entry = makeEntry({ id: 'sd-8', date: new Date(2026, 7, 5), program: 'Solo', subProgram: null });
      const model = toSeasonModel([entry], ANCHOR);
      expect(model.rows).toHaveLength(1);
      expect(model.rows[0].showId).toBe('sd-8');
    });
  });
});

describe('seasonKpis', () => {
  it('computes unfilledMainSlots over non-cancelled entries, readyForHireOrder as the window intersection, and heaviestWeekLabel', () => {
    const a1 = makeEntry({
      id: 'sd-a1',
      showId: 'show-a',
      date: new Date(2026, 7, 4), // Tue 4 Aug — week of Mon 3 Aug
      mainSlots: 4,
      confirmedMain: 3, // unfilled 1
      status: 'partially_filled',
    });
    const b1 = makeEntry({
      id: 'sd-b1',
      showId: 'show-b',
      date: new Date(2026, 7, 6), // Thu 6 Aug — same week as a1 → week of Mon 3 Aug has 2 dates
      mainSlots: 5,
      confirmedMain: 5, // unfilled 0
      status: 'fully_filled',
    });
    const a2 = makeEntry({
      id: 'sd-a2',
      showId: 'show-a',
      date: new Date(2026, 7, 12), // Wed 12 Aug — week of Mon 10 Aug has 1 date
      mainSlots: 3,
      confirmedMain: 1, // unfilled 2, but would count if not for cancellation below
      status: 'partially_filled',
    });
    const cancelled = makeEntry({
      id: 'sd-c1',
      showId: 'show-c',
      date: new Date(2026, 7, 20), // within window, but cancelled → excluded from unfilledMainSlots
      mainSlots: 6,
      confirmedMain: 0,
      status: 'cancelled',
    });
    const outsideWindow = makeEntry({
      id: 'sd-outside',
      showId: 'show-d',
      date: new Date(2026, 10, 5), // 5 Nov — outside the season window entirely
      mainSlots: 10,
      confirmedMain: 0,
      status: 'partially_filled',
    });

    const readyIds = new Set(['sd-a2', 'sd-outside', 'sd-never-existed']);

    const kpis = seasonKpis([a1, b1, a2, cancelled, outsideWindow], ANCHOR, readyIds);

    // unfilledMainSlots: 1 (a1) + 0 (b1) + 2 (a2) = 3; cancelled and
    // out-of-window entries contribute nothing.
    expect(kpis.unfilledMainSlots).toBe(3);

    // readyForHireOrder: only sd-a2 is both in readyIds and inside the
    // window (sd-outside is in readyIds but not a window date id).
    expect(kpis.readyForHireOrder).toBe(1);

    // heaviestWeekLabel: week of Mon 3 Aug has 2 dates (a1, b1) vs week of
    // Mon 10 Aug's 1 date (a2) → Mon 3 Aug wins.
    expect(kpis.heaviestWeekLabel).toBe('03/08/2026');
  });

  it('returns zeroed KPIs and an empty heaviestWeekLabel when no entries fall in the window', () => {
    const kpis = seasonKpis([], ANCHOR, new Set());
    expect(kpis.unfilledMainSlots).toBe(0);
    expect(kpis.readyForHireOrder).toBe(0);
    expect(kpis.heaviestWeekLabel).toBe('');
  });

  it('keeps the heaviest-week date count and open-slot sum consistent by excluding cancelled dates from both', () => {
    // Week of Mon 3 Aug: one active date (2 open) plus one cancelled date. The
    // cancelled date must not pad the "N dates" count, so N and M agree.
    const active = makeEntry({
      id: 'sd-w1', showId: 'show-a', date: new Date(2026, 7, 4), mainSlots: 6, confirmedMain: 4, status: 'partially_filled',
    });
    const cancelled = makeEntry({
      id: 'sd-w2', showId: 'show-b', date: new Date(2026, 7, 5), mainSlots: 6, confirmedMain: 0, status: 'cancelled',
    });

    const kpis = seasonKpis([active, cancelled], ANCHOR, new Set());
    expect(kpis.heaviestWeekLabel).toBe('03/08/2026');
    expect(kpis.heaviestWeekDates).toBe(1); // cancelled date excluded from the count
    expect(kpis.heaviestWeekOpen).toBe(2); // 6 - 4, cancelled contributes 0
    expect(kpis.unfilledDates).toBe(1); // only the active date has an open slot
  });
});

describe('toSeasonModel loadByDay', () => {
  it('excludes cancelled dates so the load bar agrees with the unfilled KPI', () => {
    const cancelled = makeEntry({
      id: 'sd-x', showId: 'show-x', date: new Date(2026, 7, 4), mainSlots: 6, confirmedMain: 0, status: 'cancelled',
    });
    const model = toSeasonModel([cancelled], ANCHOR);
    const idx = 3; // Tue 4 Aug is 3 days after Sat 1 Aug
    expect(model.loadByDay[idx].openMainSlots).toBe(0);
  });
});
