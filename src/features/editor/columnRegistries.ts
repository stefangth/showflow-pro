import type { AppRole } from '@/config/app.config';
import type { CustomFieldType } from '@/lib/customFields';
import type { ColumnDef, ColumnTemplate, ColumnTemplates } from './types';

/**
 * Static enumeration of DB columns per table that the editor can surface.
 * Source of truth: src/integrations/supabase/types.ts (auto-generated from DB schema).
 * Run `npx supabase gen types typescript` to regenerate types, then update this list.
 * Do NOT rename or drop columns here without a companion ALTER TABLE migration.
 */
export const TABLE_COLUMNS: Record<string, readonly string[]> = {
  bookings: [
    'id', 'artist_id', 'show_date_id', 'status', 'is_understudy',
    'booked_by', 'confirmed_at', 'cancelled_at', 'cancellation_reason',
    'notes', 'offered_at', 'offer_expires_at', 'offer_tier',
    'digest_sent_at', 'confirmation_digest_sent_at', 'created_at', 'updated_at',
  ],
  show_dates: [
    'id', 'show_id', 'date', 'session_1', 'session_2', 'session_3', 'venue', 'city_id',
    'status', 'notes', 'airtable_record_id', 'created_at', 'updated_at',
  ],
  shows: ['id', 'program', 'sub_program', 'status', 'required_skills', 'created_by', 'created_at', 'updated_at'],
  cities: ['id', 'name', 'airtable_record_id', 'created_at'],
  artists: ['id', 'user_id', 'name', 'email', 'phone', 'bio', 'status', 'created_at', 'updated_at'],
  // Computed/derived columns surfaced in the editor under a virtual table.
  _computed: ['day', 'slots', 'my_status', 'blocked'],
};

/** Human-readable labels for _computed virtual columns (no DB backing). */
export const COMPUTED_LABELS: Record<string, string> = {
  '_computed.day': 'Day',
  '_computed.slots': 'Slots',
  '_computed.my_status': 'My status',
  '_computed.blocked': 'Availability',
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
      'show_dates.session_1',
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
      'show_dates.session_1',
      '_computed.my_status',
    ],
  },
  'availability': {
    tables: ['show_dates', 'shows', '_computed'],
    rendered: [
      'show_dates.date',
      'shows.program',
      'show_dates.venue',
      'show_dates.session_1',
      '_computed.my_status',
      '_computed.blocked',
    ],
  },
};

/** Pages that surface custom (Airtable-synced) columns, mapped to the entity they belong to.
 *  Producer bookings table only this phase — custom fields never reach artist surfaces. */
export const CUSTOM_FIELD_PAGES: Record<string, string> = { 'bookings-producer': 'show_dates' };

/** Build a hidden custom ColumnDef from a definition's key+type. */
export function customFieldDefToColumnDef(
  def: { key: string; type: CustomFieldType }, order: number,
): ColumnDef {
  return {
    id: `custom.${def.key}`,
    table: 'custom',
    column: def.key,
    kind: 'custom',
    customType: def.type,
    defaultVisible: false,
    defaultOrder: order,
  };
}

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
        table,
        column: col,
        defaultVisible: isRendered,
        defaultOrder: isRendered ? renderedOrder : nextOrder++,
      });
    }
  }
  return defs;
}

/**
 * Given a list of columns and a label resolver, returns each column paired with
 * its display label — falling back to the raw `table.column` id when two columns
 * share the same label so they remain distinguishable.
 */
export function disambiguateLabels(
  columns: ColumnTemplate[],
  getLabel: (id: string) => string
): { columnId: string; label: string }[] {
  const counts = new Map<string, number>();
  columns.forEach(c => {
    const lbl = getLabel(c.columnId);
    counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
  });
  return columns.map(c => {
    const lbl = getLabel(c.columnId);
    return { columnId: c.columnId, label: counts.get(lbl)! > 1 ? c.columnId : lbl };
  });
}

/** @deprecated Prefer pageColumnDefs(). Kept for callers still passing through. */
export const COLUMN_REGISTRIES: Record<string, ColumnDef[]> = new Proxy({} as Record<string, ColumnDef[]>, {
  get: (_t, key: string) => pageColumnDefs(key),
});

/** Merge saved column templates with registry defaults. Handles new/removed columns. */
export function resolveColumnTemplate(
  pageKey: string,
  role: AppRole,
  savedTemplates: ColumnTemplates,
  extraDefs: ColumnDef[] = [],
): ColumnTemplate[] {
  const defs = [...pageColumnDefs(pageKey), ...extraDefs];
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
