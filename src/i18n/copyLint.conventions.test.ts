import { describe, it, expect } from 'vitest';
import { resources } from './index';
import { TERMS } from './terms';

/**
 * Extends the existing copyLint suite with the rules ratified in ADR 0012. The dash
 * and Du-form checks already live in copyLint.test.ts and are unchanged.
 *
 * These are deliberately cheap and unambiguous. A rule that needs judgement belongs
 * in docs/ui-conventions.md under [review], not here.
 */
const EXCLAMATION = /!/;
const EMOJI = /\p{Extended_Pictographic}/u;

function strings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (obj && typeof obj === 'object') return Object.values(obj as Record<string, unknown>).flatMap(strings);
  return [];
}

const all = [...strings(resources.en), ...strings(resources.de)];

describe('copy conventions (ADR 0012)', () => {
  it('no exclamation marks', () => {
    for (const s of all) expect(EXCLAMATION.test(s), s).toBe(false);
  });

  it('no emoji', () => {
    for (const s of all) expect(EMOJI.test(s), s).toBe(false);
  });

  it('terms.ts is the only place a user-facing domain term is decided', () => {
    // Any UI string that reproduces a raw domain term verbatim should be going
    // through termLabel() instead. Guards the D10 plain-language decision.
    const raw = ['Tier ladder', 'Response window', 'Blocked date', 'Hire order'];
    const offenders = all.filter((s) => raw.some((r) => s.includes(r)));
    expect(offenders, offenders.join(' | ')).toHaveLength(0);
  });

  it('every term has both languages', () => {
    for (const [key, t] of Object.entries(TERMS)) {
      expect(t.en.length, key).toBeGreaterThan(0);
      expect(t.de.length, key).toBeGreaterThan(0);
    }
  });
});
