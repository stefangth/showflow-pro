import { createContext, useContext, useEffect, useState } from 'react';
import i18n from '@/i18n';
import { detectInitialLang, isLang, persistLang, DEFAULT_LANGUAGE, type Lang } from '@/i18n/config';

interface LanguageState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LanguageContext = createContext<LanguageState | null>(null);

/**
 * Global language setting. Reads the initial language from localStorage (falling
 * back to the browser language, then English), keeps the i18next runtime in sync,
 * and persists every change. The setting UI lives in the account menu.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectInitialLang());

  // Keep the i18next runtime aligned with the detected/selected language on mount
  // and whenever it changes (the instance was initialized with the same detection,
  // but this guards remounts and hot reloads).
  useEffect(() => {
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
  }, [lang]);

  // Follow the runtime in the other direction too. Not every language change comes
  // through setLang: AppLayout forces the runtime to English for an org without the
  // language_packages entitlement by calling i18n.changeLanguage directly, WITHOUT
  // touching the stored preference. Without this listener `lang` kept reporting the
  // stored/detected language, so everything that renders from `lang` rather than
  // t() (the page minis, the help center, the demo rail) stayed German on a browser
  // set to German while every t() string around it was English. State only: the
  // stored preference is deliberately left alone, so flipping the entitlement on
  // restores the user's own language.
  useEffect(() => {
    const onChanged = (next: string) => {
      const resolved: Lang = isLang(next) ? next : DEFAULT_LANGUAGE;
      setLangState((current) => (current === resolved ? current : resolved));
    };
    i18n.on('languageChanged', onChanged);
    return () => { i18n.off('languageChanged', onChanged); };
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    persistLang(next);
    void i18n.changeLanguage(next);
  };

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageState {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
