import type { PageAccessConfig, ColumnTemplates, TablePermissions } from './types';

export interface EditorSettingRow { key: string; value: unknown; org_id: string | null }

/** Reduce org+platform app_settings rows to the effective editor config (org row wins per key). */
export function resolveEditorRows(rows: EditorSettingRow[]): {
  pageAccess: PageAccessConfig; columnTemplates: ColumnTemplates; tablePermissions: TablePermissions;
} {
  const byKey = new Map<string, unknown>();
  for (const r of rows) if (!byKey.has(r.key) || r.org_id !== null) byKey.set(r.key, r.value);
  return {
    pageAccess: (byKey.get('editor_page_access') ?? {}) as PageAccessConfig,
    columnTemplates: (byKey.get('editor_column_templates') ?? {}) as ColumnTemplates,
    tablePermissions: (byKey.get('editor_table_permissions') ?? {}) as TablePermissions,
  };
}
