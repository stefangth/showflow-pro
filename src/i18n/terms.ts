import type { Lang } from './config';

/**
 * Canonical bilingual glossary of ShowFlow's domain terms. Defined once here and
 * referenced by the Help center now; every app surface localized in phase 2 pulls
 * its term labels from this map, so the whole German UI stays terminologically
 * consistent. Role names (Admin / Produktionsteam / Artist) and proper nouns
 * (ShowFlow, Airtable) are deliberately NOT translated and are not listed here.
 */
export const TERMS = {
  hold:           { en: 'Hold',            de: 'Vormerkung' },
  softBooked:     { en: 'Soft-booked',     de: 'Vorläufig gebucht' },
  cast:           { en: 'Cast',            de: 'Besetzung' },
  tierLadder:     { en: 'Tier and ladder', de: 'Stufe und Rangfolge' },
  responseWindow: { en: 'Response window', de: 'Antwortfrist' },
  digest:         { en: 'Digest',          de: 'Tagesübersicht' },
  understudy:     { en: 'Understudy',      de: 'Zweitbesetzung' },
  hireOrder:      { en: 'Hire order',      de: 'Engagementvertrag' },
  voidOrder:      { en: 'Void',            de: 'Ungültig machen' },
  blockedDate:    { en: 'Blocked date',    de: 'Gesperrter Termin' },
} as const satisfies Record<string, Record<Lang, string>>;

export type TermKey = keyof typeof TERMS;

export function termLabel(key: TermKey, lang: Lang): string {
  return TERMS[key][lang];
}
