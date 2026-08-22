import type { AppRole } from '@/config/app.config';
import type { CustomFieldType } from '@/lib/customFields';

export interface ColumnDef {
  /** Namespaced id: `${table}.${column}`. */
  id: string;
  /** Source table the column comes from (or `_computed` / `custom`). */
  table: string;
  /** Bare DB column name within the table (or the custom key). */
  column: string;
  /** Column kind. Defaults to 'static'; 'custom' for Airtable-synced custom fields. */
  kind?: 'static' | 'custom';
  /** Present when kind === 'custom' — drives client-side format/filter/sort. */
  customType?: CustomFieldType;
  defaultVisible: boolean;
  defaultOrder: number;
}

export interface ColumnTemplate {
  columnId: string;
  visible: boolean;
  order: number;
}

export type TablePermissionLevel = 'edit' | 'view' | 'none';

export type PageAccessConfig = Record<string, AppRole[]>;
export type ColumnTemplates = Record<string, Partial<Record<AppRole, ColumnTemplate[]>>>;
export type TablePermissions = Record<string, Partial<Record<AppRole, TablePermissionLevel>>>;

export const DEFAULT_PAGE_ACCESS: PageAccessConfig = {
  '/today':        ['admin', 'producer', 'artist'],
  '/dates':        ['admin', 'producer'],
  '/artists':      ['admin', 'producer'],
  '/availability': ['artist'],
  '/admin':        ['admin'],
  '/settings':     ['admin', 'producer'],
  '/chats':        ['admin', 'producer', 'artist'],
};

export const DEFAULT_TABLE_PERMISSIONS: TablePermissions = {
  bookings:     { admin: 'edit', producer: 'edit', artist: 'view' },
  artists:      { admin: 'edit', producer: 'edit', artist: 'none' },
  availability: { admin: 'edit', producer: 'view', artist: 'edit' },
  show_dates:   { admin: 'edit', producer: 'edit', artist: 'none' },
  shows:        { admin: 'edit', producer: 'edit', artist: 'none' },
  casts:        { admin: 'edit', producer: 'view', artist: 'none' },
  cast_members: { admin: 'edit', producer: 'view', artist: 'none' },
};
