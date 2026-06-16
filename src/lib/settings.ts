export interface SlotCounts {
  main_cast: number;
  understudies: number;
}

export interface SettingsWarnings {
  /** Number of shows with NULL slot columns (unconfigured). */
  schedulingWarnings: number;
  /** True when any warning exists. */
  hasAnyWarning: boolean;
}

/**
 * Returns slot counts from a show's own columns, or null when either column is
 * NULL (i.e. the show is unconfigured). An explicit 0/0 is a valid configuration.
 */
export function showSlots(
  show: { main_cast_slots: number | null; understudy_slots: number | null } | null | undefined,
): SlotCounts | null {
  if (!show || show.main_cast_slots == null || show.understudy_slots == null) return null;
  return { main_cast: show.main_cast_slots, understudies: show.understudy_slots };
}

/** Count shows that have at least one NULL slot column. */
export function computeSchedulingWarnings(
  shows: { main_cast_slots: number | null; understudy_slots: number | null }[] | null | undefined,
): SettingsWarnings {
  const schedulingWarnings = (shows ?? []).filter(
    (s) => s.main_cast_slots == null || s.understudy_slots == null,
  ).length;
  return { schedulingWarnings, hasAnyWarning: schedulingWarnings > 0 };
}
