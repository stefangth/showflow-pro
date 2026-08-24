import { describe, it, expect } from 'vitest';
import { HELP_ITEMS } from './items';
import { STAGES } from './stages';
import { GLOSSARY } from './glossary';
import { TERMS } from '@/i18n/terms';
import { SUPPORTED_LANGUAGES } from '@/i18n/config';

const DASH = /[—–]/; // em dash, en dash

describe('help content', () => {
  it('has the expected item count and unique ids', () => {
    expect(HELP_ITEMS.length).toBe(81);
    expect(new Set(HELP_ITEMS.map((i) => i.id)).size).toBe(81);
  });

  it('never uses the removed "open" status', () => {
    expect(HELP_ITEMS.every((i) => i.status === 'new' || i.status === 'ok')).toBe(true);
  });

  it('every item is fully bilingual with a valid stage and role', () => {
    for (const i of HELP_ITEMS) {
      expect(['admin', 'producer', 'artist']).toContain(i.role);
      expect(i.stage).toBeGreaterThanOrEqual(0);
      expect(i.stage).toBeLessThan(STAGES.length);
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(i.q[lang], `${i.id} q.${lang}`).toBeTruthy();
        expect(i.a[lang], `${i.id} a.${lang}`).toBeTruthy();
      }
    }
  });

  it('contains no em/en dashes in any copy', () => {
    for (const i of HELP_ITEMS) {
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(DASH.test(i.q[lang]), `${i.id} q.${lang}`).toBe(false);
        expect(DASH.test(i.a[lang]), `${i.id} a.${lang}`).toBe(false);
      }
    }
  });

  it('every stage and glossary term is fully bilingual', () => {
    for (const s of STAGES) {
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(s.title[lang]).toBeTruthy();
        expect(s.moment[lang]).toBeTruthy();
      }
    }
    for (const g of GLOSSARY) {
      expect(TERMS[g.term], `unknown term ${g.term}`).toBeDefined();
      for (const lang of SUPPORTED_LANGUAGES) expect(g.def[lang]).toBeTruthy();
    }
  });
});
