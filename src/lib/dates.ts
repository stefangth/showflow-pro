/**
 * Shared date helpers — enforce DDMMYYYY display + timezone-safe parsing.
 *
 * All `show_dates.date` and `availability.date` columns are PG `date` (no TZ),
 * so we must parse them with an explicit `T00:00:00` to avoid UTC drift.
 */
import { format } from 'date-fns';

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

/** Format an ISO timestamp in the viewer's local date and time. */
export function formatTimestampLocal(input: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(input));
}

/** Format with weekday + dd/MM/yyyy, e.g. `Mon, 23/04/2026`. */
export function formatDateWithWeekday(input: string | Date): string {
  const d = typeof input === 'string' ? parseDateOnly(input) : input;
  return format(d, 'EEE, dd/MM/yyyy');
}

/** Convert a Date back to `YYYY-MM-DD` (used as DB key). */
export function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
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
