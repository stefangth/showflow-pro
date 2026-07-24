// Pure helper for the new-order wizard's per-date "Copy to all dates" control:
// stamp one date's duration into every OTHER assigned date, leaving each date's
// sessions untouched. Generic over the schedule shape so it needs no import of
// the wizard-internal DateSchedule type.

/** Return a new schedules map where every entry's `durationMin` equals the
 *  source date's, keeping sessions (and any other fields) as-is. No-ops
 *  (returns the same reference) when the source id is absent. */
export function copyDurationToAll<T extends { durationMin: string }>(
  schedules: Record<string, T>,
  sourceId: string,
): Record<string, T> {
  const source = schedules[sourceId];
  if (!source) return schedules;
  const { durationMin } = source;
  const next: Record<string, T> = {};
  for (const [id, schedule] of Object.entries(schedules)) {
    next[id] = id === sourceId ? schedule : { ...schedule, durationMin };
  }
  return next;
}
