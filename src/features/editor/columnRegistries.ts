import type { AppRole } from '@/config/app.config';
import type { ColumnDef, ColumnTemplate, ColumnTemplates } from './types';

export const COLUMN_REGISTRIES: Record<string, ColumnDef[]> = {
  'bookings-producer': [
    { id: 'date',        label: 'Date',        defaultVisible: true, defaultOrder: 0 },
    { id: 'day',         label: 'Day',         defaultVisible: true, defaultOrder: 1 },
    { id: 'time',        label: 'Time',        defaultVisible: true, defaultOrder: 2 },
    { id: 'program',     label: 'Program',     defaultVisible: true, defaultOrder: 3 },
    { id: 'sub_program', label: 'Sub Program', defaultVisible: true, defaultOrder: 4 },
    { id: 'venue',       label: 'Venue',       defaultVisible: true, defaultOrder: 5 },
    { id: 'city',        label: 'City',        defaultVisible: true, defaultOrder: 6 },
    { id: 'status',      label: 'Status',      defaultVisible: true, defaultOrder: 7 },
    { id: 'slots',       label: 'Slots',       defaultVisible: true, defaultOrder: 8 },
  ],
  'bookings-artist': [
    { id: 'date',   label: 'Date',      defaultVisible: true, defaultOrder: 0 },
    { id: 'show',   label: 'Show',      defaultVisible: true, defaultOrder: 1 },
    { id: 'venue',  label: 'Venue',     defaultVisible: true, defaultOrder: 2 },
    { id: 'time',   label: 'Time',      defaultVisible: true, defaultOrder: 3 },
    { id: 'status', label: 'My Status', defaultVisible: true, defaultOrder: 4 },
  ],
  'availability': [
    { id: 'date',     label: 'Date',        defaultVisible: true, defaultOrder: 0 },
    { id: 'show',     label: 'Show',        defaultVisible: true, defaultOrder: 1 },
    { id: 'venue',    label: 'Venue',       defaultVisible: true, defaultOrder: 2 },
    { id: 'time',     label: 'Time',        defaultVisible: true, defaultOrder: 3 },
    { id: 'response', label: 'My Response', defaultVisible: true, defaultOrder: 4 },
  ],
};

/** Merge saved column templates with registry defaults. Handles new columns added after save. */
export function resolveColumnTemplate(
  pageKey: string,
  role: AppRole,
  savedTemplates: ColumnTemplates
): ColumnTemplate[] {
  const defs = COLUMN_REGISTRIES[pageKey] ?? [];
  const saved = savedTemplates[pageKey]?.[role];

  if (!saved || saved.length === 0) {
    return defs.map(d => ({ columnId: d.id, visible: d.defaultVisible, order: d.defaultOrder }));
  }

  const savedMap = new Map(saved.map(s => [s.columnId, s]));
  let nextOrder = Math.max(...saved.map(s => s.order), -1) + 1;

  return defs
    .map(d => savedMap.get(d.id) ?? { columnId: d.id, visible: d.defaultVisible, order: nextOrder++ })
    .sort((a, b) => a.order - b.order);
}
