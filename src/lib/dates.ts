/**
 * Shared date helpers — enforce DDMMYYYY display + timezone-safe parsing.
 *
 * All `show_dates.date` and `availability.date` columns are PG `date` (no TZ),
 * so we must parse them with an explicit `T00:00:00` to avoid UTC drift.
 */
import { format, parse } from 'date-fns';

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
 * `show_date_offer_tiers.opened_at`) as `dd/MM/yyyy`.
 *
 * Use this — NOT `formatDateDMY` — for timestamp values: `formatDateDMY` is for
 * date-only `YYYY-MM-DD` strings and appends `T00:00:00`, which turns a full
 * timestamp into an Invalid Date (and date-fns `format` then throws).
 */
export function formatTimestampDMY(input: string): string {
  return format(new Date(input), 'dd/MM/yyyy');
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
