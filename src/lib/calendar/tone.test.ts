import { describe, it, expect } from 'vitest';
import { PRODUCER_TONES, ARTIST_TONES, TONE_FILL, TONE_TEXT, artistStatusLabel } from './tone';

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
  it('exposes an abstract Tone value alongside the CSS classes, for consumers that need the raw tone', () => {
    expect(PRODUCER_TONES.partially_filled.tone).toBe('warning');
    expect(PRODUCER_TONES.fully_filled.tone).toBe('success');
    expect(PRODUCER_TONES.cancelled.tone).toBe('destructive');
    expect(ARTIST_TONES.suggested.tone).toBe('accent');
    expect(ARTIST_TONES.blocked.tone).toBe('destructive');
    expect(ARTIST_TONES.unanswered.tone).toBe('muted');
  });
  it('maps every Tone to a filled-segment class and a text class, all semantic tokens', () => {
    const tones = ['success', 'warning', 'muted', 'destructive', 'accent'] as const;
    tones.forEach(tone => {
      expect(TONE_FILL[tone]).toMatch(/^bg-/);
      expect(TONE_TEXT[tone]).toMatch(/^text-/);
      expect(TONE_FILL[tone]).not.toMatch(/#|rgb/);
      expect(TONE_TEXT[tone]).not.toMatch(/#|rgb/);
    });
    expect(TONE_FILL.success).toBe('bg-success');
    expect(TONE_FILL.accent).toBe('bg-primary');
    expect(TONE_TEXT.destructive).toBe('text-destructive');
  });
});

describe('artistStatusLabel', () => {
  it('falls back to the fixed ARTIST_TONES label when no override is given', () => {
    expect(artistStatusLabel('unanswered')).toBe('Not offered');
    expect(artistStatusLabel('unanswered', undefined)).toBe('Not offered');
    expect(artistStatusLabel('unanswered', {})).toBe('Not offered');
  });
  it('prefers a matching override key', () => {
    expect(artistStatusLabel('unanswered', { unanswered: 'Not booked' })).toBe('Not booked');
  });
  it('falls back per-key for statuses missing from a partial override map', () => {
    // 'blocked' has no flow-aware equivalent in bookingStatusLabels; a caller
    // passing only the flow-derived keys must not lose the Blocked label.
    expect(artistStatusLabel('blocked', { unanswered: 'Not booked', confirmed: 'Booked' })).toBe('Blocked');
  });
});
