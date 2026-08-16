import { describe, it, expect } from 'vitest';
import { PRODUCER_TONES, ARTIST_TONES, TONE_FILL, TONE_TEXT, TONE_BG, artistStatusLabel } from './tone';

describe('calendar tones', () => {
  it('maps producer statuses to labels + the 3-token tint/fg/rail classes', () => {
    expect(PRODUCER_TONES.fully_filled.label).toBe('Fully filled');
    expect(PRODUCER_TONES.partially_filled.label).toBe('Casting');

    expect(PRODUCER_TONES.fully_filled.badgeClass).toBe('bg-[var(--green-100)] text-[var(--green-600)]');
    expect(PRODUCER_TONES.fully_filled.railClass).toBe('bg-[var(--green-500)]');

    expect(PRODUCER_TONES.partially_filled.badgeClass).toContain('--amber-100');
    expect(PRODUCER_TONES.partially_filled.badgeClass).toContain('--amber-600');
    expect(PRODUCER_TONES.partially_filled.railClass).toBe('bg-[var(--amber-500)]');

    expect(PRODUCER_TONES.open.badgeClass).toBe('bg-[var(--surface-3)] text-muted-foreground');
    expect(PRODUCER_TONES.open.railClass).toBe('bg-[var(--text-faint)]');

    expect(PRODUCER_TONES.cancelled.badgeClass).toBe('bg-[var(--red-100)] text-[var(--red-600)]');
    expect(PRODUCER_TONES.cancelled.railClass).toBe('bg-[var(--red-500)]');
    expect(PRODUCER_TONES.unconfigured.badgeClass).toBe('bg-[var(--red-100)] text-[var(--red-600)]');
    expect(PRODUCER_TONES.unconfigured.railClass).toBe('bg-[var(--red-500)]');

    // no hardcoded hex/rgb literals — token vars or DS utility classes only
    Object.values(PRODUCER_TONES).forEach(t => {
      expect(t.badgeClass).not.toMatch(/#|rgb/);
      expect(t.railClass).not.toMatch(/#|rgb/);
    });
  });

  it('maps artist statuses, offer uses accent and hold uses amber (warning)', () => {
    expect(ARTIST_TONES.suggested.label).toBe('Offer');
    expect(ARTIST_TONES.soft_booked.label).toBe('Hold');

    expect(ARTIST_TONES.suggested.badgeClass).toBe('bg-accent-50 text-accent-700');
    expect(ARTIST_TONES.suggested.railClass).toBe('bg-primary');

    expect(ARTIST_TONES.confirmed.badgeClass).toBe('bg-[var(--green-100)] text-[var(--green-600)]');
    expect(ARTIST_TONES.confirmed.railClass).toBe('bg-[var(--green-500)]');

    expect(ARTIST_TONES.soft_booked.badgeClass).toBe('bg-[var(--amber-100)] text-[var(--amber-600)]');
    expect(ARTIST_TONES.soft_booked.railClass).toBe('bg-[var(--amber-500)]');

    expect(ARTIST_TONES.blocked.badgeClass).toBe('bg-[var(--red-100)] text-[var(--red-600)]');
    expect(ARTIST_TONES.blocked.railClass).toBe('bg-[var(--red-500)]');

    expect(ARTIST_TONES.unanswered.badgeClass).toBe('bg-[var(--surface-3)] text-muted-foreground');
    expect(ARTIST_TONES.unanswered.railClass).toBe('bg-[var(--text-faint)]');
  });

  it('exposes an abstract Tone value alongside the CSS classes, for consumers that need the raw tone', () => {
    expect(PRODUCER_TONES.partially_filled.tone).toBe('warning');
    expect(PRODUCER_TONES.fully_filled.tone).toBe('success');
    expect(PRODUCER_TONES.cancelled.tone).toBe('destructive');
    expect(ARTIST_TONES.suggested.tone).toBe('accent');
    expect(ARTIST_TONES.blocked.tone).toBe('destructive');
    expect(ARTIST_TONES.unanswered.tone).toBe('muted');
  });

  it('maps every Tone to a rail (fill) class and a fg (text) class, all DS tokens', () => {
    const tones = ['success', 'warning', 'muted', 'destructive', 'accent'] as const;
    tones.forEach(tone => {
      expect(TONE_FILL[tone]).toMatch(/^bg-/);
      expect(TONE_TEXT[tone]).toMatch(/^text-/);
      expect(TONE_FILL[tone]).not.toMatch(/#|rgb/);
      expect(TONE_TEXT[tone]).not.toMatch(/#|rgb/);
    });
    expect(TONE_FILL.success).toBe('bg-[var(--green-500)]');
    expect(TONE_FILL.warning).toBe('bg-[var(--amber-500)]');
    expect(TONE_FILL.muted).toBe('bg-[var(--text-faint)]');
    expect(TONE_FILL.destructive).toBe('bg-[var(--red-500)]');
    expect(TONE_FILL.accent).toBe('bg-primary');

    expect(TONE_TEXT.success).toBe('text-[var(--green-600)]');
    expect(TONE_TEXT.warning).toBe('text-[var(--amber-600)]');
    expect(TONE_TEXT.muted).toBe('text-muted-foreground');
    expect(TONE_TEXT.destructive).toBe('text-[var(--red-600)]');
    expect(TONE_TEXT.accent).toBe('text-accent-700');
  });

  it('maps every Tone to a tint (chip/block background) class, all DS tokens', () => {
    const tones = ['success', 'warning', 'muted', 'destructive', 'accent'] as const;
    tones.forEach(tone => {
      expect(TONE_BG[tone]).toMatch(/^bg-/);
      expect(TONE_BG[tone]).not.toMatch(/#|rgb/);
    });
    expect(TONE_BG.success).toBe('bg-[var(--green-100)]');
    expect(TONE_BG.warning).toBe('bg-[var(--amber-100)]');
    expect(TONE_BG.muted).toBe('bg-[var(--surface-3)]');
    expect(TONE_BG.destructive).toBe('bg-[var(--red-100)]');
    expect(TONE_BG.accent).toBe('bg-accent-50');
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
