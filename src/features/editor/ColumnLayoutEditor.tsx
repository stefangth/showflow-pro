import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, GripHorizontal, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/features/auth/AuthContext';
import { type AppRole, roleLabel } from '@/config/app.config';
import { useEditor, useEditorConfig } from './EditorContext';
import { disambiguateLabels } from './columnRegistries';
import type { ColumnTemplate } from './types';

interface ColumnLayoutEditorProps {
  pageKey: string;
}

/**
 * Inline column layout editor rendered above a table when editor mode is active.
 * Drag chips to reorder, click the eye to show/hide. Edits the template for the
 * currently simulated role (viewAsRole) so changes are immediately reflected below.
 */
export function ColumnLayoutEditor({ pageKey }: ColumnLayoutEditorProps) {
  const { roles, viewAsRole } = useAuth();
  const { isEditorMode, getColumnLabel, getColumnDefs, getColumnTemplate } = useEditorConfig();
  const { saveColumnTemplate } = useEditor();

  const [draft, setDraft] = useState<ColumnTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Drag state
  const dragColId = useRef<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const effectiveRole: AppRole = viewAsRole
    ?? (roles.includes('admin') ? 'admin' : roles.includes('producer') ? 'producer' : 'artist');

  const defs = useMemo(() => getColumnDefs(pageKey), [getColumnDefs, pageKey]);

  // Sync draft whenever role or saved templates change
  useEffect(() => {
    setDraft(getColumnTemplate(pageKey, effectiveRole));
    setDirty(false);
  }, [pageKey, effectiveRole, getColumnTemplate]);

  const sorted = useMemo(() => [...draft].sort((a, b) => a.order - b.order), [draft]);

  const chipItems = useMemo(
    () => {
      const labelMap = new Map(
        disambiguateLabels(sorted, getColumnLabel).map(({ columnId, label }) => [columnId, label])
      );
      return sorted.map(col => ({ col, label: labelMap.get(col.columnId) ?? col.columnId }));
    },
    [sorted, getColumnLabel]
  );

  // ── Drag handlers ──────────────────────────────────────────────

  const onDragStart = useCallback((colId: string) => {
    dragColId.current = colId;
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, colId: string) => {
    e.preventDefault();
    if (dragColId.current && dragColId.current !== colId) {
      setDragOverColId(colId);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    const fromId = dragColId.current;
    if (!fromId || fromId === targetColId) {
      setDragOverColId(null);
      return;
    }
    setDraft(prev => {
      const ordered = [...prev].sort((a, b) => a.order - b.order);
      const fromIdx = ordered.findIndex(c => c.columnId === fromId);
      const toIdx = ordered.findIndex(c => c.columnId === targetColId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const reordered = [...ordered];
      const [item] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, item);
      // Reassign contiguous order values so they stay clean
      return reordered.map((c, i) => ({ ...c, order: i }));
    });
    dragColId.current = null;
    setDragOverColId(null);
    setDirty(true);
  }, []);

  const onDragEnd = useCallback(() => {
    dragColId.current = null;
    setDragOverColId(null);
  }, []);

  // ── Visibility toggle ──────────────────────────────────────────

  const toggle = useCallback((colId: string) => {
    setDraft(prev => prev.map(c => c.columnId === colId ? { ...c, visible: !c.visible } : c));
    setDirty(true);
  }, []);

  // ── Reset & save ───────────────────────────────────────────────

  const reset = useCallback(() => {
    setDraft(defs.map(d => ({ columnId: d.id, visible: d.defaultVisible, order: d.defaultOrder })));
    setDirty(true);
  }, [defs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveColumnTemplate(pageKey, effectiveRole, draft);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (!isEditorMode || defs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-warning/40 bg-warning/5 text-sm mb-3">
      {/* Label */}
      <span className="text-xs text-muted-foreground shrink-0 font-medium flex items-center gap-1.5">
        Columns
        <Badge variant="outline" className="text-xs border-warning/60 text-warning py-0">
          {roleLabel(effectiveRole)}
        </Badge>
      </span>

      <Separator orientation="vertical" className="h-5 bg-warning/30 shrink-0" />

      {/* Draggable chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {chipItems.map(({ col, label }) => (
          <div
            key={col.columnId}
            draggable
            onDragStart={() => onDragStart(col.columnId)}
            onDragOver={e => onDragOver(e, col.columnId)}
            onDrop={e => onDrop(e, col.columnId)}
            onDragEnd={onDragEnd}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs cursor-grab active:cursor-grabbing select-none transition-all ${
              col.visible
                ? 'border-border bg-background'
                : 'border-border/50 bg-muted text-muted-foreground opacity-60'
            } ${dragOverColId === col.columnId ? 'ring-2 ring-primary ring-offset-1' : ''}`}
          >
            <GripHorizontal className="h-3 w-3 text-muted-foreground shrink-0" />

            <Tooltip>
              <TooltipTrigger asChild>
                <span className={col.visible ? '' : 'line-through'}>{label}</span>
              </TooltipTrigger>
              <TooltipContent className="font-mono">{col.columnId}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => toggle(col.columnId)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  {col.visible
                    ? <Eye className="h-2.5 w-2.5" />
                    : <EyeOff className="h-2.5 w-2.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{col.visible ? 'Hide' : 'Show'}</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        <Button variant="secondary" size="sm" className="h-6 px-2 text-xs gap-1" onClick={reset}>
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          <Save className="h-3 w-3" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
