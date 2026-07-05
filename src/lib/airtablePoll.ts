/**
 * Pure helpers for the Airtable poll interval. The master cron ticks every 5 min,
 * so 5 is the resolution floor. Mirrors the edge-side constants in
 * supabase/functions/airtable-poll/index.ts (two runtimes, no shared import).
 */
export const MIN_POLL_INTERVAL_MINUTES = 5;

/** Admin-selectable cadences, in minutes. */
export const POLL_INTERVAL_PRESET_MINUTES = [5, 15, 30, 60, 120, 240, 480] as const;

/** Human label for an interval: minutes below an hour, else whole hours. */
export function formatInterval(min: number): string {
  if (min % 60 === 0 && min >= 60) {
    const h = min / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  return `${min} minutes`;
}

export const POLL_INTERVAL_PRESETS = POLL_INTERVAL_PRESET_MINUTES.map((value) => ({
  value,
  label: formatInterval(value),
}));

/** Coerce a stored value to a safe interval (≥ floor); invalid input → floor. */
export function clampInterval(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_POLL_INTERVAL_MINUTES ? n : MIN_POLL_INTERVAL_MINUTES;
}

/** When the next poll becomes eligible, or null if the org has never synced. */
export function nextSyncAt(
  lastSyncedAt: string | Date | null | undefined,
  intervalMin: number,
): Date | null {
  if (!lastSyncedAt) return null;
  const last = lastSyncedAt instanceof Date ? lastSyncedAt : new Date(lastSyncedAt);
  return new Date(last.getTime() + clampInterval(intervalMin) * 60_000);
}
