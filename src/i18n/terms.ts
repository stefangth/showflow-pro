import type { Lang } from './config';

/**
 * Canonical bilingual glossary of ShowFlow's domain terms. Defined once here and
 * referenced by the Help center now; every app surface localized in phase 2 pulls
 * its term labels from this map, so the whole German UI stays terminologically
 * consistent. Role names (Admin / Produktionsteam / Artist) and proper nouns
 * (ShowFlow, Airtable) are deliberately NOT translated and are not listed here.
 */
export const TERMS = {
  hold:           { en: 'Waiting on you',           de: 'Wartet auf dich' },
  softBooked:     { en: 'Said yes, waiting on you', de: 'Hat zugesagt, wartet auf dich' },
  cast:           { en: 'Cast',                     de: 'Besetzung' },
  tierLadder:     { en: 'Who this date asks',       de: 'Wer bei diesem Termin gefragt wird' },
  responseWindow: { en: 'Answer by',                de: 'Antworten bis' },
  digest:         { en: 'Daily send',               de: 'Täglicher Versand' },
  understudy:     { en: 'Understudy',               de: 'Zweitbesetzung' },
  hireOrder:      { en: 'Contract',                 de: 'Engagementvertrag' },
  voidOrder:      { en: 'Void',                     de: 'Ungültig machen' },
  blockedDate:    { en: 'Not free',                 de: 'Nicht frei' },
} as const satisfies Record<string, Record<Lang, string>>;

export type TermKey = keyof typeof TERMS;

export function termLabel(key: TermKey, lang: Lang): string {
  return TERMS[key][lang];
}
