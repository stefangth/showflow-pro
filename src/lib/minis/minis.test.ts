import { describe, it, expect } from 'vitest';
import { MINIS, PAGE_KEYS } from './index';

const LANGS = ['en', 'de'] as const;

describe('MINIS registry', () => {
  it('every def has a bilingual eyebrow and exactly four steps per variant', () => {
    expect(PAGE_KEYS.length).toBeGreaterThan(0);
    for (const key of PAGE_KEYS) {
      const def = MINIS[key];
      expect(def, key).toBeTruthy();
      expect(def.page, `${key} page field`).toBe(key);
      for (const l of LANGS) expect(def.eyebrow[l].length, `${key} eyebrow ${l}`).toBeGreaterThan(0);
      const variants = Object.entries(def.variants);
      expect(variants.length, `${key} has at least one variant`).toBeGreaterThan(0);
      for (const [role, steps] of variants) {
        expect(steps!.length, `${key}/${role} step count`).toBe(4);
        for (const st of steps!)
          for (const l of LANGS) {
            expect(st.label[l].length, `${key}/${role} label ${l}`).toBeGreaterThan(0);
            expect(st.text[l].length, `${key}/${role} text ${l}`).toBeGreaterThan(0);
          }
      }
    }
  });

  it('DE is never a verbatim copy of EN (guards against untranslated paste-through)', () => {
    for (const key of PAGE_KEYS) {
      const def = MINIS[key];
      expect(def.eyebrow.de, `${key} eyebrow untranslated`).not.toBe(def.eyebrow.en);
      for (const [role, steps] of Object.entries(def.variants))
        steps!.forEach((st, i) => {
          expect(st.text.de, `${key}/${role} step ${i} text untranslated`).not.toBe(st.text.en);
        });
    }
  });
});
