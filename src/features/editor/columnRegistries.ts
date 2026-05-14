import type { AppRole } from '@/config/app.config';
import type { ColumnDef, ColumnTemplate, ColumnTemplates } from './types';

/**
 * Static enumeration of DB columns per table that the editor can surface.
 * Mirrors src/integrations/supabase/types.ts — keep in sync when adding columns.
 */
export const TABLE_COLUMNS: Record<string, readonly string[]> = {
  availability: ['id', 'artist_id', 'date', 'status', 'recurrence_rule', 'created_at', 'updated_at'],
  bookings: [
    'id', 'artist_id', 'show_date_id', 'status', 'is_understudy',
    'booked_by', 'confirmed_at', 'cancelled_at', 'cancellation_reason',
    'notes', 'created_at', 'updated_at',
  ],
  show_dates: [
    'id', 'show_id', 'date', 'start_time', 'end_time', 'venue', 'city_id',
    'status', 'notes', 'airtable_record_id', 'created_at', 'updated_at',
  ],
  shows: ['id', 'program', 'sub_program', 'status', 'required_skills', 'created_by', 'created_at', 'updated_at'],
  cities: ['id', 'name', 'country', 'created_at'],
  artists: ['id', 'user_id', 'stage_name', 'email', 'phone', 'bio', 'skills', 'status', 'created_at', 'updated_at'],
  // Computed/derived columns surfaced in the editor under a virtual table.
  _computed: ['day', 'slots', 'my_status'],
};

/**
 * For each page, declare which tables back it and which columns are rendered
 * by default (in display order). Columns from `tables` that aren't in `rendered`
 * are listed in the editor but hidden by default.
 */
export interface PageColumnSpec {
  tables: string[];
  /** Rendered columns in display order. Column ID is `${table}.${column}`. */
  rendered: string[];
}

export const PAGE_COLUMN_SPECS: Record<string, PageColumnSpec> = {
  'bookings-producer': {
    tables: ['show_dates', 'shows', 'cities', 'bookings', '_computed'],
    rendered: [
      'show_dates.date',
      '_computed.day',
      'show_dates.start_time',
      'shows.program',
      'shows.sub_program',
      'show_dates.venue',
      'cities.name',
      'show_dates.status',
      '_computed.slots',
    ],
  },
  'bookings-artist': {
    tables: ['show_dates', 'shows', 'bookings', '_computed'],
    rendered: [
      'show_dates.date',
      'shows.program',
      'show_dates.venue',
      'show_dates.start_time',
      '_computed.my_status',
    ],
  },
  'availability': {
    tables: ['show_dates', 'shows', 'cities', 'availability'],
    rendered: [
      'show_dates.date',
      'shows.program',
      'show_dates.venue',
      'show_dates.start_time',
      'availability.status',
    ],
  },
};

/** Build the full ordered column list for a page from its spec. */
export function pageColumnDefs(pageKey: string): ColumnDef[] {
  const spec = PAGE_COLUMN_SPECS[pageKey];
  if (!spec) return [];
  const renderedIdx = new Map(spec.rendered.map((id, i) => [id, i]));
  const defs: ColumnDef[] = [];
  let nextOrder = spec.rendered.length;
  for (const table of spec.tables) {
    const cols = TABLE_COLUMNS[table] ?? [];
    for (const col of cols) {
      const id = `${table}.${col}`;
      const renderedOrder = renderedIdx.get(id);
      const isRendered = renderedOrder !== undefined;
      defs.push({
        id,
        label: id,
        table,
        column: col,
        defaultVisible: isRendered,
        defaultOrder: isRendered ? renderedOrder : nextOrder++,
      });
    }
  }
  return defs;
}

/** @deprecated Prefer pageColumnDefs(). Kept for callers still passing through. */
export const COLUMN_REGISTRIES: Record<string, ColumnDef[]> = new Proxy({} as Record<string, ColumnDef[]>, {
  get: (_t, key: string) => pageColumnDefs(key),
});

/** Merge saved column templates with registry defaults. Handles new/removed columns. */
export function resolveColumnTemplate(
  pageKey: string,
  role: AppRole,
  savedTemplates: ColumnTemplates
): ColumnTemplate[] {
  const defs = pageColumnDefs(pageKey);
  const saved = savedTemplates[pageKey]?.[role];

  if (!saved || saved.length === 0) {
    return defs.map(d => ({ columnId: d.id, visible: d.defaultVisible, order: d.defaultOrder }));
  }

  const validIds = new Set(defs.map(d => d.id));
  const savedFiltered = saved.filter(s => validIds.has(s.columnId));
  const savedMap = new Map(savedFiltered.map(s => [s.columnId, s]));
  let nextOrder = savedFiltered.length === 0 ? 0 : Math.max(...savedFiltered.map(s => s.order)) + 1;

  return defs
    .map(d => savedMap.get(d.id) ?? { columnId: d.id, visible: d.defaultVisible, order: nextOrder++ })
    .sort((a, b) => a.order - b.order);
}
