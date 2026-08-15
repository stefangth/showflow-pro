import { describe, it, expect } from 'vitest';
import { monthMatrix, shiftPeriod, periodWindow } from './period';

describe('period', () => {
  it('monthMatrix is Monday-first with correct leading pad', () => {
    // Aug 2026: 1st is a Saturday → Monday-first leading pad = 5 nulls
    const cells = monthMatrix(new Date(2026, 7, 1));
    expect(cells.slice(0, 5).every(c => c === null)).toBe(true);
    expect(cells[5]).toEqual(new Date(2026, 7, 1));
    expect(cells.length % 7).toBe(0);
  });
  it('monthMatrix always returns a fixed 42-cell (6-week) grid', () => {
    // Feb 2026 (non-leap): 1st is a Sunday → leading pad 6, 28 days → old
    // trailing-pad-to-multiple-of-7 code returned 35 here, not 42.
    expect(monthMatrix(new Date(2026, 1, 1)).length).toBe(42);
    // Mar 2026: 1st is a Sunday → leading pad 6, 31 days — a differently
    // shaped month, still must land on the fixed 42-cell grid.
    expect(monthMatrix(new Date(2026, 2, 1)).length).toBe(42);
  });
  it('week window is Monday..Sunday containing the anchor', () => {
    const { start, end } = periodWindow(new Date(2026, 7, 14), 'week'); // Fri 14 Aug
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0);   // Sunday
    expect(start.getDate()).toBe(10);
  });
  it('shiftPeriod month moves by one calendar month', () => {
    const next = shiftPeriod(new Date(2026, 7, 14), 'month', 1);
    expect(next.getMonth()).toBe(8);
  });
});
