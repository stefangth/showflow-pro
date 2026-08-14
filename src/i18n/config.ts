export type Lang = 'en' | 'de';

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const satisfies readonly Lang[];
export const DEFAULT_LANGUAGE: Lang = 'en';
export const STORAGE_KEY = 'showflow.lang.v1';

/** Native endonym for each language, shown in the language picker. Deliberately NOT
 *  translated: a language is always labelled in its own language, so a speaker who
 *  lands in a mis-detected UI can still recognize their language. */
export const LANGUAGE_LABELS: Record<Lang, string> = {
  en: 'English',
  de: 'Deutsch',
};

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

export function loadStoredLang(): Lang | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLang(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}

export function detectInitialLang(): Lang {
  const stored = loadStoredLang();
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  const prefix = nav.slice(0, 2).toLowerCase();
  return isLang(prefix) ? prefix : DEFAULT_LANGUAGE;
}
