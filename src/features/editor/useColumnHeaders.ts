import { useMemo } from 'react';
import { useEditorConfig } from './EditorContext';
import type { ColumnTemplate } from './types';

interface ColumnHeader {
  columnId: string;
  headerLabel: string;
}

/**
 * Returns display metadata for each visible column's table header.
 * Falls back to the raw table.column id when two columns share the same label,
 * consistent with the ColumnLayoutEditor chip disambiguation.
 */
export function useColumnHeaders(orderedColumns: ColumnTemplate[]): ColumnHeader[] {
  const { isEditorMode, getColumnLabel } = useEditorConfig();
  return useMemo(() => {
    const visible = orderedColumns.filter(c => c.visible);
    const counts = new Map<string, number>();
    visible.forEach(c => {
      const lbl = getColumnLabel(c.columnId);
      counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
    });
    return visible.map(c => {
      const lbl = getColumnLabel(c.columnId);
      const headerLabel = isEditorMode ? c.columnId : (counts.get(lbl)! > 1 ? c.columnId : lbl);
      return { columnId: c.columnId, headerLabel };
    });
  }, [orderedColumns, getColumnLabel, isEditorMode]);
}
