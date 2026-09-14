import { describe, it, expect } from 'vitest';
import { TERMS, termLabel } from './terms';
import { SUPPORTED_LANGUAGES } from './config';

describe('TERMS glossary', () => {
  it('every term has non-empty text in every language', () => {
    for (const [key, byLang] of Object.entries(TERMS)) {
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(byLang[lang], `${key}.${lang}`).toBeTruthy();
      }
    }
  });

  it('termLabel resolves both languages', () => {
    expect(termLabel('understudy', 'en')).toBe('Understudy');
    expect(termLabel('understudy', 'de')).toBe('Zweitbesetzung');
    expect(termLabel('hireOrder', 'de')).toBe('Engagementvertrag');
  });

  it('termLabel follows the workspace type for the three vocabulary terms', () => {
    expect(termLabel('cast', 'en')).toBe('Cast');
    expect(termLabel('cast', 'en', 'staffing')).toBe('Team');
    expect(termLabel('understudy', 'de', 'staffing')).toBe('Ersatz');
    expect(termLabel('hireOrder', 'en', 'staffing')).toBe('Work order');
    expect(termLabel('hold', 'de', 'staffing')).toBe('Wartet auf dich'); // untouched term
  });
});
