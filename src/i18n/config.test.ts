import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isLang, detectInitialLang, loadStoredLang, persistLang, STORAGE_KEY, DEFAULT_LANGUAGE } from './config';

describe('i18n config', () => {
  beforeEach(() => localStorage.clear());

  it('isLang narrows to supported codes', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('de')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it('persist + load round-trips', () => {
    persistLang('de');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('de');
    expect(loadStoredLang()).toBe('de');
  });

  it('ignores a stored unsupported value', () => {
    localStorage.setItem(STORAGE_KEY, 'fr');
    expect(loadStoredLang()).toBeNull();
  });

  it('detection prefers stored over navigator', () => {
    persistLang('en');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(detectInitialLang()).toBe('en');
  });

  it('detection falls back to navigator prefix', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT');
    expect(detectInitialLang()).toBe('de');
  });

  it('detection defaults to en for an unsupported navigator', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    expect(detectInitialLang()).toBe(DEFAULT_LANGUAGE);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });
});
