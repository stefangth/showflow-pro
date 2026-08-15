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
