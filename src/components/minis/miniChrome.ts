import type { Lang } from '@/i18n/config';

/**
 * Bilingual chrome copy for the page minis.
 *
 * This is NOT an i18n namespace on purpose: `PageMiniView` is language-pure (it takes
 * `lang` as a prop and renders in tests with no i18next runtime), so a `t()` call here
 * would be the one string in the component whose language came from somewhere else. It
 * lives in its own module rather than inside `PageMini.tsx` so it can be exported without
 * breaking that file's fast-refresh component-only rule, and so `src/i18n/copyLint.test.ts`
 * can scan it for dashes and formal address like every other string in the app.
 */
export const MINI_CHROME: Record<'example' | 'resumeHint' | 'resumeCta' | 'hide', Record<Lang, string>> = {
  /** Marks the step illustrations as invented. They render fabricated tiers, people and
   *  audit lines, which would otherwise read as this org's own data. */
  example: { en: 'Example', de: 'Beispiel' },
  resumeHint: { en: 'Pick up where you left off', de: 'Mach dort weiter, wo du aufgehört hast' },
  resumeCta: { en: 'Resume', de: 'Wieder einblenden' },
  hide: { en: 'Hide', de: 'Ausblenden' },
};
