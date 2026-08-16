import { describe, it, expect } from 'vitest';
import { sessionMinutes, minutesToLabel, bandBounds, sessionLabel } from './time';

describe('time', () => {
  it('parses HH:MM:SS and HH:MM to minutes', () => {
    expect(sessionMinutes('14:30:00')).toBe(870);
    expect(sessionMinutes('09:05')).toBe(545);
  });
  it('formats minutes back to an HH:MM label', () => {
    expect(minutesToLabel(870)).toBe('14:30');
    expect(minutesToLabel(545)).toBe('09:05');
  });
  it('sessionLabel formats a raw session value to HH:MM, empty for null/undefined/empty', () => {
    expect(sessionLabel('14:30:00')).toBe('14:30');
    expect(sessionLabel('14:30')).toBe('14:30');
    expect(sessionLabel('09:05:00')).toBe('09:05');
    expect(sessionLabel(null)).toBe('');
    expect(sessionLabel(undefined)).toBe('');
    expect(sessionLabel('')).toBe('');
  });
  it('bandBounds derives padded whole-hour extent, falls back when empty', () => {
    expect(bandBounds(['19:30:00', '14:00:00', null])).toEqual({ startMinutes: 14 * 60, endMinutes: 20 * 60 });
    expect(bandBounds([null, undefined])).toEqual({ startMinutes: 14 * 60, endMinutes: 23 * 60 });
  });
  it('bandBounds honors a custom fallback when the list is empty', () => {
    expect(bandBounds([], { startHour: 9, endHour: 18 })).toEqual({ startMinutes: 9 * 60, endMinutes: 18 * 60 });
  });
});
