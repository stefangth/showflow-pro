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

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useLanguage())).toThrow(/LanguageProvider/);
  });
});
