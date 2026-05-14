import type { AppRole } from '@/config/app.config';

export interface ColumnDef {
  id: string;
  label: string;
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
  '/dashboard':    ['admin', 'producer', 'artist'],
  '/bookings':     ['admin', 'producer'],
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
