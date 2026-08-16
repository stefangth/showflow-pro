import { describe, it, expect } from 'vitest';
import { SEASON_HANDOVER, CUE_IDS } from './scenes';

describe('SEASON_HANDOVER', () => {
  it('has exactly 7 scenes', () => {
    expect(SEASON_HANDOVER).toHaveLength(7);
  });

  it('has unique ids and valid cue references', () => {
    const ids = SEASON_HANDOVER.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEASON_HANDOVER) {
      expect(s.route).toMatch(/^\//);
      expect(['admin', 'producer', 'artist']).toContain(s.persona);
      expect(s.estMin).toBeGreaterThan(0);
      expect(s.title.en).not.toBe('');
      expect(s.title.de).not.toBe('');
      expect(s.say.en).not.toBe('');
      expect(s.say.de).not.toBe('');
      expect(s.title.en).not.toBe(s.title.de);
      expect(s.say.en).not.toBe(s.say.de);
      s.cues.forEach((c) => expect(CUE_IDS).toContain(c));
    }
  });

  it('scene 3 (holds-expire) carries the offer-expiry cue sequence', () => {
    const scene = SEASON_HANDOVER.find((s) => s.id === 'holds-expire');
    expect(scene?.cues).toEqual([
      'artist_accepts_offer',
      'run_clock_to_1700',
      'drop_notifications',
    ]);
  });

  it('scene 5 (hire-order) carries the fill + issue cue sequence', () => {
    const scene = SEASON_HANDOVER.find((s) => s.id === 'hire-order');
    expect(scene?.cues).toEqual(['fill_date', 'issue_hire_order']);
  });
});
