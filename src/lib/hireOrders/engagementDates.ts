// Pure merge helper for an EngagementDate's per-date sessions/duration.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries a byte-identical
// copy of `SessionOverride` + `resolveEngagementSessions` (the two runtimes
// cannot share an import). Change both files in the same commit.

export interface SessionOverride {
  sessions?: string[];
  duration_min?: number | null;
}

/** Merge a show_date's synced running order with an optional wizard override.
 *  `sessions`/`duration_min` are each overridden only when present on the
 *  override (an empty `sessions` array is an explicit clear, not "absent"). */
export function resolveEngagementSessions(
  synced: { sessions: string[]; duration_min: number | null },
  override: SessionOverride | undefined,
): { sessions: string[]; duration_min: number | null } {
  return {
    sessions: override && override.sessions !== undefined ? override.sessions : synced.sessions,
    duration_min: override && override.duration_min !== undefined ? override.duration_min : synced.duration_min,
  };
}
