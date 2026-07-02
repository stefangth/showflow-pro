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

/**
 * Compute which setting keys the user has edited, comparing the draft against the
 * union of (keys that already have a persisted row) AND (all keys the form can edit).
 *
 * Iterating only persisted rows misses a first-ever value: a key with no DB row
 * (e.g. `resend_from_address` never saved before) would never count as dirty, so
 * Save stays disabled and it can never be saved. An absent persisted row is treated
 * as the default/empty baseline — a draft value that differs from it is dirty.
 *
 * `undefined` draft values (key not present in the draft at all) are never dirty:
 * the user hasn't touched that key, so there's nothing to save.
 */
export function computeSettingsDirtyKeys(
  settings: { key: string; value: unknown }[] | null | undefined,
  draft: Record<string, unknown>,
  editableKeys: readonly string[],
): string[] {
  const persisted = new Map<string, unknown>();
  for (const s of settings ?? []) persisted.set(s.key, s.value);

  const keys = new Set<string>([...persisted.keys(), ...editableKeys]);
  const dirty: string[] = [];
  for (const key of keys) {
    // A key the user hasn't entered into the draft can't be dirty.
    if (!(key in draft)) continue;
    // Absent persisted row → baseline is `undefined`; any real draft value differs.
    if (JSON.stringify(persisted.get(key)) !== JSON.stringify(draft[key])) dirty.push(key);
  }
  return dirty;
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
