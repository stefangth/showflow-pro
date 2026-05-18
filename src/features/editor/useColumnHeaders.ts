import { useMemo } from 'react';
import { useEditorConfig } from './EditorContext';
import { disambiguateLabels } from './columnRegistries';
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
    return disambiguateLabels(visible, getColumnLabel).map(({ columnId, label }) => ({
      columnId,
      headerLabel: isEditorMode ? columnId : label,
    }));
  }, [orderedColumns, getColumnLabel, isEditorMode]);
}
