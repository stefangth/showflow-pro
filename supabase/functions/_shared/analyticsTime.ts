/**
 * Timestamp normalisation for the Supabase Analytics API (logs.all).
 *
 * VERIFIED against the live API 2026-08-04: `timestamp` comes back as a **microsecond**
 * epoch integer, e.g. 1785867796145000 — not an ISO string, and not milliseconds. Passing it
 * straight to `new Date()` yields a date in the year 58,000, which is silent: it does not
 * throw, it just never matches anything. That is exactly how health-rollup fetched rows and
 * aggregated none, and why the Edge functions panel rendered "Last failure Invalid Date".
 *
 * Every consumer of an Analytics row must funnel its timestamp through here.
 */

// Epoch magnitudes, used to tell the units apart. A plausible "now" is ~1.79e9 seconds,
// ~1.79e12 ms, ~1.79e15 µs, so thresholds an order of magnitude below each keep the
// classification unambiguous for any date this system will ever see.
const MICROSECONDS_MIN = 1e14;
const MILLISECONDS_MIN = 1e11;
const SECONDS_MIN = 1e8;

/**
 * Normalise an Analytics timestamp to an ISO string, or null when it cannot be interpreted.
 * Accepts the microsecond epoch the API actually returns, plus millisecond/second epochs and
 * ISO strings, so a future change in the API's units degrades to a correct reading rather
 * than a silently wrong one.
 */
export function toIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  // Numeric epoch, either as a number or as a digit string.
  const numeric = typeof value === "number"
    ? value
    : (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN);

  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric >= MICROSECONDS_MIN ? numeric / 1000
      : numeric >= MILLISECONDS_MIN ? numeric
      : numeric >= SECONDS_MIN ? numeric * 1000
      : NaN;
    if (!Number.isFinite(ms)) return null;
    const at = new Date(ms);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }

  if (typeof value === "string") {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }

  return null;
}

/** UTC calendar day ('YYYY-MM-DD') for an Analytics timestamp, or null if unreadable. */
export function analyticsDayKey(value: unknown): string | null {
  const iso = toIsoTimestamp(value);
  return iso === null ? null : iso.slice(0, 10);
}
