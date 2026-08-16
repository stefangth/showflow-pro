/**
 * Shared date helpers — enforce DDMMYYYY display + timezone-safe parsing.
 *
 * All `show_dates.date` and `availability.date` columns are PG `date` (no TZ),
 * so we must parse them with an explicit `T00:00:00` to avoid UTC drift.
 */
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import i18n from '@/i18n';

/**
 * The date-fns locale for the app's active language, or `undefined` (date-fns'
 * enUS default) for English. Read from the i18n singleton at call time so a
 * language switch reformats weekday names without threading a locale through
 * every call site. Only the weekday name is language-dependent; the dd/MM/yyyy
 * and yyyy-MM-dd shapes below are numeric and locale-invariant, so they never
 * pass this.
 */
export function dfLocale() {
  return i18n.language?.startsWith('de') ? de : undefined;
}

/** Parse a `YYYY-MM-DD` string into a local-midnight Date (timezone-safe). */
export function parseDateOnly(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/** Format a `YYYY-MM-DD` string (or Date) as `dd/MM/yyyy`. */
export function formatDateDMY(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'dd/MM/yyyy');
}

/**
 * Format a full ISO timestamp (e.g. a `timestamptz` column like
 * `show_date_offer_tiers.opened_at`) as `dd/MM/yyyy`, using the **UTC** calendar
 * date so the result is deterministic across browser timezones.
 *
 * Use this — NOT `formatDateDMY` — for timestamp values: `formatDateDMY` is for
 * date-only `YYYY-MM-DD` strings and appends `T00:00:00`, which turns a full
 * timestamp into an Invalid Date (and date-fns `format` then throws). Pinning to
 * UTC also avoids the per-user drift that a local-timezone `new Date(input)`
 * would cause near midnight.
 */
export function formatTimestampDMY(input: string): string {
  const d = new Date(input);
  return format(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), 'dd/MM/yyyy');
}

/** Format an ISO timestamp in the app language's date and time, e.g.
 *  `23 Apr 2026, 14:30` (`23. Apr. 2026, 14:30` in German). English pins to
 *  `en-GB` (day-first) rather than the bare `'en'` code, which resolves to
 *  US-style month-first `M/D/YYYY` — a real ambiguity on hire-order documents
 *  ("03/04" = 3 Apr vs 4 Mar). Matches `formatDayMonthShortYear`'s explicit
 *  regional locale so date order stays day-first regardless of the visitor's
 *  browser region. */
export function formatTimestampLocal(input: string): string {
  const locale = i18n.language?.startsWith('de') ? 'de-DE' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(input));
}

/** Format with weekday + dd/MM/yyyy, e.g. `Mon, 23/04/2026` (`Mo, 23/04/2026` in German). */
export function formatDateWithWeekday(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'EEE, dd/MM/yyyy', { locale: dfLocale() });
}

/** Format a date-only string/Date as the full month name + year, e.g. `April 2026`
 *  (`April 2026` / `März 2026` in German). Weekday-free calendar header. */
export function formatMonthYear(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'MMMM yyyy', { locale: dfLocale() });
}

/** Format a date-only string/Date as a zero-padded day + short month + year, e.g.
 *  `23 Apr 2026` (`23 Apr. 2026` in German). Unlike `formatDayMonthShortYear`
 *  (Intl, no zero-pad, `de` day-period) this keeps the date-fns `dd MMM yyyy`
 *  shape, so English output is byte-identical to the previous inline `format`. */
export function formatDayMonthYear(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'dd MMM yyyy', { locale: dfLocale() });
}

/** Format a date-only string/Date as full weekday + day + full month + year, e.g.
 *  `Thursday, 23 April 2026` (`Donnerstag, 23 April 2026` in German). */
export function formatFullWeekdayDate(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'EEEE, d MMMM yyyy', { locale: dfLocale() });
}

/** Convert a Date back to `YYYY-MM-DD` (used as DB key). */
export function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Localized short weekday name for a `YYYY-MM-DD` string or Date, e.g. `Mon` / `Mo`. */
export function weekdayShort(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'EEE', { locale: dfLocale() });
}

/** The seven short weekday labels in Monday-first order (the app's week start),
 *  localized to the active language. 2024-01-01 is a Monday. */
export function weekdayShortLabels(): string[] {
  return Array.from({ length: 7 }, (_, i) => format(new Date(2024, 0, 1 + i), 'EEE', { locale: dfLocale() }));
}

/** Localized single-letter weekday initial for a `YYYY-MM-DD` string or Date,
 *  e.g. `M` (Mon), `S` (Sun). Derived from the date itself, so callers keyed on
 *  `getDay()` stay correct in every locale without a fixed initials array. */
export function weekdayNarrow(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'EEEEE', { locale: dfLocale() });
}

/** Format a date-only string/Date as day + short month + year, e.g. `23 Apr 2026`
 *  (`23. Apr. 2026` in German). English keeps the en-GB day-first order. */
export function formatDayMonthShortYear(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  const locale = i18n.language?.startsWith('de') ? 'de' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/**
 * True iff `date` is strictly before the start of `today` — a date-only,
 * timezone-safe comparison (via `toDateKey`, so time-of-day on either side is
 * ignored). Today itself is never "past". `today` defaults to `new Date()`.
 */
export function isPastDate(date: Date, today: Date = new Date()): boolean {
  return toDateKey(date) < toDateKey(today);
}

/**
 * Today's calendar date (YYYY-MM-DD) in Europe/Berlin, derived from `date`.
 * Mirrors `supabase/functions/_shared/tierFill.ts`'s `berlinDateKey` — the
 * booking engine (offer expiry windows, tier-at-risk) is Berlin-anchored, so
 * any "is this today / already expired" read on the frontend must agree with
 * the edge runtime's notion of "today" rather than the visitor's local
 * timezone. Kept as a separate frontend twin (not imported across runtimes)
 * per the edge/frontend split — see the `needsYou` queue derivation for the
 * primary consumer.
 */
export function berlinDateKey(date: Date): string {
  // en-CA yields ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Shared "dimmed but interactive" class for a past-date row/card/cell.
 * Deliberately opacity-only — never combine with `pointer-events-none` — so
 * past dates stay fully clickable across every surface that uses it.
 */
export const PAST_DATE_TINT = 'opacity-60';

/**
 * The past-date tint, applied by construction: returns `PAST_DATE_TINT` when
 * `date` is in the past, else `undefined`. Every row/card that wants the
 * shared "past but still clickable" treatment should splice this into its
 * `cn(...)` call instead of hand-writing `isPastDate(...) && PAST_DATE_TINT`
 * -- the inline form is easy to forget on a new surface (it was, repeatedly),
 * where this helper can only be skipped by name. Accepts `null` for a row
 * whose date could not be parsed (never tinted). `today` defaults to
 * `new Date()`, same as `isPastDate`.
 */
export function pastRowClassName(date: Date | null, today: Date = new Date()): string | undefined {
  return date && isPastDate(date, today) ? PAST_DATE_TINT : undefined;
}
