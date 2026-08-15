// Per-org server-side language selection (emails + hire-order PDFs).
//
// This module is the PURE, framework-free primitive shared in spirit with the
// edge runtime: `supabase/functions/_shared/orgLocale.ts` hard-copies the same
// key literal and `coerceLocale` body (the edge runtime cannot import from
// src/). Both are covered by tests asserting the "org_language" literal so the
// two copies cannot drift.
//
// Server locale is intentionally a two-value union, NOT the app's broader
// language list: server-generated content ships in English and German only.

/** app_settings key holding an org's chosen language ("en" | "de"). */
export const ORG_LANGUAGE_SETTING_KEY = "org_language";

/** The languages server-generated content (emails, PDFs) can render in. */
export type ServerLocale = "en" | "de";

/**
 * Narrow any stored/interpolated value to a ServerLocale. Only the exact string
 * "de" selects German; everything else (including "DE", "", null, non-strings)
 * falls back to English, so an unknown or malformed setting can never leak a
 * half-translated surface.
 */
export function coerceLocale(value: unknown): ServerLocale {
  return value === "de" ? "de" : "en";
}
