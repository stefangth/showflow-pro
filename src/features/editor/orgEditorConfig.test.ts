import { describe, it, expect } from 'vitest';
import { resolveEditorRows, normalizePageAccessKeys, type EditorSettingRow } from './orgEditorConfig';

describe('normalizePageAccessKeys', () => {
  it('remaps legacy /dashboard and /bookings keys to /today and /dates', () => {
    const out = normalizePageAccessKeys({ '/dashboard': ['admin'], '/bookings': ['producer'], '/artists': ['admin'] });
    expect(out).toEqual({ '/today': ['admin'], '/dates': ['producer'], '/artists': ['admin'] });
  });

  it('leaves already-migrated keys untouched and lets a new key win over a stale one', () => {
    const out = normalizePageAccessKeys({ '/today': ['admin'], '/dashboard': ['producer'] });
    expect(out).toEqual({ '/today': ['admin'] });
  });

  it('is a no-op on an empty map', () => {
    expect(normalizePageAccessKeys({})).toEqual({});
  });
});

describe('resolveEditorRows', () => {
  it('prefers the org row over the platform row per key', () => {
    const rows = [
      { key: 'editor_page_access', value: { '/x': ['admin'] }, org_id: null },
      { key: 'editor_page_access', value: { '/x': ['producer'] }, org_id: 'o1' },
    ];
    expect(resolveEditorRows(rows).pageAccess).toEqual({ '/x': ['producer'] });
  });
  it('falls back to platform when no org row', () => {
    const rows = [{ key: 'editor_table_permissions', value: { t: { admin: 'edit' } }, org_id: null }];
    expect(resolveEditorRows(rows).tablePermissions).toEqual({ t: { admin: 'edit' } });
  });
  it('defaults to empty objects when absent', () => {
    expect(resolveEditorRows([])).toEqual({ pageAccess: {}, columnTemplates: {}, tablePermissions: {} });
  });
  it('normalizes legacy page-access slugs read from app_settings', () => {
    const rows: EditorSettingRow[] = [
      { key: 'editor_page_access', value: { '/dashboard': ['admin'], '/bookings': ['producer'] }, org_id: 'org-1' },
    ];
    expect(resolveEditorRows(rows).pageAccess).toEqual({ '/today': ['admin'], '/dates': ['producer'] });
  });
});
