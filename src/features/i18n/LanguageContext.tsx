import { createContext, useContext, useEffect, useState } from 'react';
import i18n from '@/i18n';
import { detectInitialLang, persistLang, type Lang } from '@/i18n/config';

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
