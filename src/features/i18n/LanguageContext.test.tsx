import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import i18n from '@/i18n';
import { STORAGE_KEY } from '@/i18n/config';
import { LanguageProvider, useLanguage } from './LanguageContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

afterAll(async () => { await i18n.changeLanguage('en'); });

describe('useLanguage', () => {
  beforeEach(() => { localStorage.clear(); });

  it('setLang updates i18n and persists', async () => {
    const { result } = renderHook(() => useLanguage(), { wrapper });
    await act(async () => { result.current.setLang('de'); });
    expect(result.current.lang).toBe('de');
    expect(i18n.language).toBe('de');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('de');
    await act(async () => { result.current.setLang('en'); });
  });

  // Regression: AppLayout forces the runtime to English for an org without the
  // language_packages entitlement by calling i18n.changeLanguage directly. `lang`
  // has to follow, or everything rendered from `lang` instead of t() (page minis,
  // help center, demo rail) keeps rendering German next to English t() strings.
  it('follows a runtime language change made outside setLang, without persisting it', async () => {
    localStorage.setItem(STORAGE_KEY, 'de');
    const { result } = renderHook(() => useLanguage(), { wrapper });
    expect(result.current.lang).toBe('de');

    await act(async () => { await i18n.changeLanguage('en'); });

    expect(result.current.lang).toBe('en');
    // The user's own preference is untouched, so re-entitling the org restores it.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('de');
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useLanguage())).toThrow(/LanguageProvider/);
  });
});
