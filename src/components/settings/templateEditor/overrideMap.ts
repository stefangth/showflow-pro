/** True only for a non-null object containing at least one own key. */
export function hasOwnKeys(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}

/** Converts a number-input string without treating an empty edit as zero. */
export function numericInputValue(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Removes blank values and values identical to the supplied copy defaults. */
export function compactCopyMap<CopyKey extends string>(
  draft: Partial<Record<CopyKey, unknown>>,
  defaults: Record<CopyKey, string>,
): Partial<Record<CopyKey, string>> {
  const compact: Partial<Record<CopyKey, string>> = {};
  for (const key of Object.keys(defaults) as CopyKey[]) {
    const value = draft[key];
    if (typeof value === "string" && value.trim() !== "" && value !== defaults[key]) {
      compact[key] = value;
    }
  }
  return compact;
}

/**
 * Removes only empty override branches. It never mutates the draft and leaves
 * populated base/role data byte-for-byte intact for each domain resolver.
 */
export function compactThemeMap<Theme extends { base?: unknown; roles?: unknown }>(draft: Theme): Theme {
  const compact = { ...draft } as Theme & { base?: unknown; roles?: unknown };
  if (!hasOwnKeys(compact.base)) delete compact.base;

  if (hasOwnKeys(compact.roles)) {
    const roles: Record<string, unknown> = {};
    for (const [key, style] of Object.entries(compact.roles)) {
      if (hasOwnKeys(style)) roles[key] = style;
    }
    if (hasOwnKeys(roles)) compact.roles = roles;
    else delete compact.roles;
  } else {
    delete compact.roles;
  }

  return compact as Theme;
}
