import { describe, it, expect } from 'vitest';
import { PRODUCER_TONES, ARTIST_TONES } from './tone';

describe('calendar tones', () => {
  it('maps producer statuses to labels + semantic token classes', () => {
    expect(PRODUCER_TONES.fully_filled.label).toBe('Fully filled');
    expect(PRODUCER_TONES.partially_filled.label).toBe('Casting');
    expect(PRODUCER_TONES.fully_filled.badgeClass).toContain('success');
    expect(PRODUCER_TONES.cancelled.badgeClass).toContain('destructive');
    // no hardcoded hex
    Object.values(PRODUCER_TONES).forEach(t => expect(t.badgeClass).not.toMatch(/#|rgb/));
  });
  it('maps artist statuses, offer uses accent and hold uses warning', () => {
    expect(ARTIST_TONES.suggested.label).toBe('Offer');
    expect(ARTIST_TONES.soft_booked.label).toBe('Hold');
    expect(ARTIST_TONES.suggested.railClass).toContain('primary'); // accent/violet == primary token
    expect(ARTIST_TONES.confirmed.badgeClass).toContain('success');
  });
});
