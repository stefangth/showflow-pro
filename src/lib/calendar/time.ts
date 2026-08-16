/**
 * Pure helpers for parsing/formatting the "HH:MM:SS" | "HH:MM" session-time
 * strings stored on `show_dates.session_1/2/3` (nullable) into minutes-since-
 * midnight, and for deriving the padded whole-hour time-grid extent the Week
 * lens needs. Parsing is defensive (slice-based, not a Date/regex parse)
 * since these are raw DB strings, not validated input.
 */

const DEFAULT_FALLBACK = { startHour: 14, endHour: 23 };

/** "14:30:00" | "14:30" → 870 (minutes since midnight). */
export function sessionMinutes(value: string): number {
  const hh = Number(value.slice(0, 2));
  const mm = Number(value.slice(3, 5));
  return hh * 60 + mm;
}

/** 870 → "14:30". */
export function minutesToLabel(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Derives the padded whole-hour extent (in minutes since midnight) spanning
 * every parseable session time in `values`. Padding floors the earliest time
 * down to its hour and ceils the latest time up to its hour. Falls back to
 * `fallback` (default 14:00-23:00) when no value parses.
 */
export function bandBounds(
  values: (string | null | undefined)[],
  fallback: { startHour: number; endHour: number } = DEFAULT_FALLBACK,
): { startMinutes: number; endMinutes: number } {
  const minutes = values
    .filter((v): v is string => v != null)
    .map(sessionMinutes);
  if (minutes.length === 0) {
    return { startMinutes: fallback.startHour * 60, endMinutes: fallback.endHour * 60 };
  }
  const min = Math.min(...minutes);
  const max = Math.max(...minutes);
  return {
    startMinutes: Math.floor(min / 60) * 60,
    endMinutes: Math.ceil(max / 60) * 60,
  };
}
