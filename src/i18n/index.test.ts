import { describe, it, expect, afterAll } from 'vitest';
import i18n from './index';

afterAll(async () => { await i18n.changeLanguage('en'); });

describe('i18n instance', () => {
  it('initializes and resolves a common key', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('nav.help')).toBe('Help');
  });

  it('switches language for common and help namespaces', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.t('nav.help')).toBe('Hilfe');
    expect(i18n.t('hero', { ns: 'help' })).toBe('Was Leute fragen, und wo die App es beantwortet');
    await i18n.changeLanguage('en');
  });

  it('pluralizes the count line', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('count_unfiltered', { ns: 'help', count: 1, newCount: 0 })).toContain('1 question ·');
    expect(i18n.t('count_unfiltered', { ns: 'help', count: 25, newCount: 3 })).toContain('25 questions ·');
  });
});
