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
 * Compute which setting keys the user has edited, considering ONLY `editableKeys`
 * (the keys this form actually manages). This is an allowlist, not a union with every
 * persisted key: a key SettingsPage seeds into its draft but does not own — e.g.
 * `airtable_poll_interval_minutes`, which has a platform-default row and is edited from
 * the Airtable Sync tab — must never count as dirty, or a Save here would write the stale
 * draft value back over the value the owning surface just wrote.
 *
 * A first-ever value is still caught: because every editable key is always considered, a
 * key with no DB row (e.g. `resend_from_address` never saved before) is dirty as soon as
 * the draft holds a value — an absent persisted row is the default/empty baseline.
 *
 * `undefined` draft values (key not present in the draft at all) are never dirty:
 * the user hasn't touched that key, so there's nothing to save.
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

  // editableKeys is an ALLOWLIST: only keys SettingsPage actually manages can be dirty (and
  // therefore saved). Unioning with persisted.keys() would let a key owned by another surface
  // (e.g. airtable_poll_interval_minutes, seeded into the draft from its platform default) show
  // as dirty and get clobbered with the stale draft value on Save.
  const keys = new Set<string>(editableKeys);
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
