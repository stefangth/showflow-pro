import type { PageAccessConfig, ColumnTemplates, TablePermissions } from './types';

export interface EditorSettingRow { key: string; value: unknown; org_id: string | null }

/** Legacy → current page-access slug keys, for orgs that saved Editor-mode page
 *  access before the today/dates/contracts slug rename. `/hire-orders` is absent
 *  on purpose: it was never a DEFAULT_PAGE_ACCESS / persisted page-access key. */
const LEGACY_PAGE_ACCESS_KEYS: Readonly<Record<string, string>> = {
  '/dashboard': '/today',
  '/bookings': '/dates',
};

/** Remap persisted legacy page-access keys to their current slug. A value already
 *  present under the new key wins over a stale legacy one (new keys are written on
 *  the next save, so this only matters for a half-migrated row). Pure. */
export function normalizePageAccessKeys(pa: PageAccessConfig): PageAccessConfig {
  const out: PageAccessConfig = {};
  for (const [key, roles] of Object.entries(pa)) {
    const target = LEGACY_PAGE_ACCESS_KEYS[key] ?? key;
    if (!(target in out) || key === target) out[target] = roles;
  }
  return out;
}

/** Reduce org+platform app_settings rows to the effective editor config (org row wins per key). */
export function resolveEditorRows(rows: EditorSettingRow[]): {
  pageAccess: PageAccessConfig; columnTemplates: ColumnTemplates; tablePermissions: TablePermissions;
} {
  const byKey = new Map<string, unknown>();
  for (const r of rows) if (!byKey.has(r.key) || r.org_id !== null) byKey.set(r.key, r.value);
  return {
    pageAccess: normalizePageAccessKeys((byKey.get('editor_page_access') ?? {}) as PageAccessConfig),
    columnTemplates: (byKey.get('editor_column_templates') ?? {}) as ColumnTemplates,
    tablePermissions: (byKey.get('editor_table_permissions') ?? {}) as TablePermissions,
  };
}
