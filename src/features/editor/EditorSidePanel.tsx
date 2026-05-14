import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Save } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AppRole } from '@/config/app.config';
import { ROUTES } from '@/config/app.config';
import { useEditor } from './EditorContext';
import { pageColumnDefs, resolveColumnTemplate } from './columnRegistries';
import {
  DEFAULT_PAGE_ACCESS,
  DEFAULT_TABLE_PERMISSIONS,
  type ColumnTemplate,
  type PageAccessConfig,
  type TablePermissionLevel,
  type TablePermissions,
} from './types';

interface EditorSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ALL_ROLES: AppRole[] = ['admin', 'producer', 'artist'];

const ROUTE_LABELS: Record<string, string> = {
  [ROUTES.DASHBOARD]:    'Dashboard',
  [ROUTES.BOOKINGS]:     'Shows & Bookings',
  [ROUTES.ARTISTS]:      'Artists',
  [ROUTES.AVAILABILITY]: 'Availability',
  [ROUTES.ADMIN]:        'Admin',
  [ROUTES.SETTINGS]:     'Settings',
  [ROUTES.CHATS]:        'Chats',
};

const PAGE_KEYS: Record<string, string> = {
  [ROUTES.BOOKINGS]:     'bookings-producer',
  [ROUTES.AVAILABILITY]: 'availability',
};

const TABLE_KEYS = Object.keys(DEFAULT_TABLE_PERMISSIONS);

export function EditorSidePanel({ open, onOpenChange }: EditorSidePanelProps) {
  const location = useLocation();
  const { pageAccess, columnTemplates, tablePermissions, savePageAccess, saveColumnTemplate, saveTablePermission } = useEditor();
  const effectivePageAccess = { ...DEFAULT_PAGE_ACCESS, ...pageAccess };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:w-[540px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2">
            Page Settings
            <Badge variant="outline" className="text-xs font-mono font-normal">
              {location.pathname}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="access" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-6 mt-4 shrink-0">
            <TabsTrigger value="access" className="flex-1">Access</TabsTrigger>
            <TabsTrigger value="layout" className="flex-1">Layout</TabsTrigger>
            <TabsTrigger value="permissions" className="flex-1">Permissions</TabsTrigger>
          </TabsList>

          <TabsContent value="access" className="flex-1 overflow-hidden mt-0">
            <AccessTab
              pageAccess={pageAccess}
              onSave={savePageAccess}
              currentRoute={location.pathname}
            />
          </TabsContent>

          <TabsContent value="layout" className="flex-1 overflow-hidden mt-0">
            <LayoutTab
              columnTemplates={columnTemplates}
              currentRoute={location.pathname}
              pageAccess={effectivePageAccess}
              onSave={saveColumnTemplate}
            />
          </TabsContent>

          <TabsContent value="permissions" className="flex-1 overflow-hidden mt-0">
            <PermissionsTab
              tablePermissions={tablePermissions}
              onSave={saveTablePermission}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/* ── Tab A: Page Access ──────────────────────────────────────── */

function AccessTab({
  pageAccess,
  onSave,
  currentRoute,
}: {
  pageAccess: PageAccessConfig;
  onSave: (config: PageAccessConfig) => Promise<void>;
  currentRoute: string;
}) {
  const [draft, setDraft] = useState<PageAccessConfig>({});
  const [saving, setSaving] = useState(false);

  // Merge defaults with DB config
  const effective = { ...DEFAULT_PAGE_ACCESS, ...pageAccess, ...draft };

  const toggleRole = (route: string, role: AppRole) => {
    const current = effective[route] ?? [];
    const next = current.includes(role)
      ? current.filter(r => r !== role)
      : [...current, role];
    setDraft(prev => ({ ...prev, [route]: next }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(effective);
      setDraft({});
    } finally {
      setSaving(false);
    }
  };

  const routes = Object.keys(ROUTE_LABELS);
  const hasDraft = Object.keys(draft).length > 0;

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-1">
          <p className="text-xs text-muted-foreground mb-4">
            Control which roles can navigate to each page. Admin always has access in editor mode.
          </p>
          {routes.map(route => {
            const roles = effective[route] ?? [];
            const isCurrentPage = route === currentRoute;
            const zeroRoles = roles.length === 0;
            return (
              <div
                key={route}
                className={`rounded-lg border p-3 space-y-2 ${isCurrentPage ? 'border-primary/40 bg-primary/5' : 'border-border'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{ROUTE_LABELS[route]}</span>
                  <div className="flex items-center gap-1">
                    {isCurrentPage && <Badge variant="secondary" className="text-xs">current</Badge>}
                    {zeroRoles && (
                      <Badge variant="destructive" className="text-xs">no access</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {ALL_ROLES.map(role => (
                    <div key={role} className="flex items-center gap-1.5">
                      <Switch
                        id={`${route}-${role}`}
                        checked={roles.includes(role)}
                        onCheckedChange={() => toggleRole(route, role)}
                        disabled={route === ROUTES.ADMIN && role === 'admin'}
                      />
                      <Label htmlFor={`${route}-${role}`} className="text-xs capitalize cursor-pointer">
                        {role}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="px-6 py-4 border-t border-border shrink-0">
        <Button onClick={handleSave} disabled={!hasDraft || saving} className="w-full gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save Access Rules'}
        </Button>
      </div>
    </div>
  );
}

/* ── Tab B: Column Layout ────────────────────────────────────── */

function LayoutTab({
  columnTemplates,
  currentRoute,
  pageAccess,
  onSave,
}: {
  columnTemplates: Record<string, Partial<Record<AppRole, ColumnTemplate[]>>>;
  currentRoute: string;
  pageAccess: PageAccessConfig;
  onSave: (pageKey: string, role: AppRole, columns: ColumnTemplate[]) => Promise<void>;
}) {
  const pageKey = PAGE_KEYS[currentRoute];
  const [selectedRole, setSelectedRole] = useState<AppRole>('admin');
  const [localCols, setLocalCols] = useState<ColumnTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pageKey) return;
    setLocalCols(resolveColumnTemplate(pageKey, selectedRole, columnTemplates));
  }, [pageKey, selectedRole, columnTemplates]);

  if (!pageKey) {
    return (
      <div className="px-6 py-8 flex items-center justify-center">
        <Alert>
          <AlertDescription className="text-sm text-muted-foreground">
            Column templates are not available for this page. Navigate to Shows &amp; Bookings or Availability to configure column layouts.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const defs = pageColumnDefs(pageKey);
  const roleHasAccess = (pageAccess[currentRoute] ?? []).includes(selectedRole);
  const readOnly = !roleHasAccess;

  const toggle = (colId: string) => {
    if (readOnly) return;
    setLocalCols(prev => prev.map(c => c.columnId === colId ? { ...c, visible: !c.visible } : c));
  };

  const move = (colId: string, dir: -1 | 1) => {
    if (readOnly) return;
    setLocalCols(prev => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex(c => c.columnId === colId);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev;
      const newOrder = sorted[idx].order;
      const swapOrder = sorted[swapIdx].order;
      return prev.map(c => {
        if (c.columnId === sorted[idx].columnId) return { ...c, order: swapOrder };
        if (c.columnId === sorted[swapIdx].columnId) return { ...c, order: newOrder };
        return c;
      });
    });
  };

  const reset = () => {
    setLocalCols(defs.map(d => ({ columnId: d.id, visible: d.defaultVisible, order: d.defaultOrder })));
  };

  const handleSave = async () => {
    if (readOnly) return;
    setSaving(true);
    try {
      await onSave(pageKey, selectedRole, localCols);
    } finally {
      setSaving(false);
    }
  };

  // Group columns by table, preserving the per-table order from defs.
  const sorted = [...localCols].sort((a, b) => a.order - b.order);
  const tableOrder: string[] = [];
  const byTable = new Map<string, ColumnTemplate[]>();
  for (const col of sorted) {
    const def = defs.find(d => d.id === col.columnId);
    const table = def?.table ?? 'unknown';
    if (!byTable.has(table)) { byTable.set(table, []); tableOrder.push(table); }
    byTable.get(table)!.push(col);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground shrink-0">Configure for role:</Label>
          <Select value={selectedRole} onValueChange={v => setSelectedRole(v as AppRole)}>
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_ROLES.map(r => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-3">
          {readOnly && (
            <Alert variant="destructive" className="border-warning/40 bg-warning/10 text-foreground">
              <AlertDescription className="text-xs">
                <span className="capitalize font-medium">{selectedRole}</span> has no access to{' '}
                <code className="font-mono">{currentRoute}</code>. Grant access in the Access tab to
                manage its column layout.
              </AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">
            Columns are grouped by source table; names match the database schema. Toggle the eye to
            show/hide; use arrows to reorder within the page.
          </p>
          {tableOrder.map(table => {
            const cols = byTable.get(table)!;
            return (
              <div key={table} className="space-y-1">
                <div className="flex items-center gap-2 pt-2 pb-1">
                  <span className="text-xs font-mono font-medium text-muted-foreground">{table}</span>
                  <div className="flex-1 h-px bg-border" />
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">{cols.length}</Badge>
                </div>
                {cols.map(col => {
                  const def = defs.find(d => d.id === col.columnId);
                  const fullIdx = sorted.findIndex(s => s.columnId === col.columnId);
                  return (
                    <div
                      key={col.columnId}
                      className={`flex items-center gap-2 rounded-md border border-border px-3 py-2 bg-card ${readOnly ? 'opacity-60' : ''}`}
                    >
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          onClick={() => move(col.columnId, -1)}
                          disabled={readOnly || fullIdx === 0}
                          className="disabled:opacity-30 hover:text-foreground text-muted-foreground"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => move(col.columnId, 1)}
                          disabled={readOnly || fullIdx === sorted.length - 1}
                          className="disabled:opacity-30 hover:text-foreground text-muted-foreground"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                      <span className={`flex-1 text-xs font-mono ${col.visible ? '' : 'text-muted-foreground line-through'}`}>
                        {def?.column ?? col.columnId}
                      </span>
                      <button
                        onClick={() => toggle(col.columnId)}
                        disabled={readOnly}
                        className={`shrink-0 ${col.visible ? 'text-foreground' : 'text-muted-foreground'} disabled:cursor-not-allowed`}
                      >
                        {col.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="px-6 py-4 border-t border-border shrink-0 flex gap-2">
        <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <Button onClick={handleSave} disabled={saving || readOnly} className="flex-1 gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : readOnly ? 'No access' : `Save for ${selectedRole}`}
        </Button>
      </div>
    </div>
  );
}

/* ── Tab C: Table Permissions ────────────────────────────────── */

function PermissionsTab({
  tablePermissions,
  onSave,
}: {
  tablePermissions: TablePermissions;
  onSave: (tableKey: string, role: AppRole, level: TablePermissionLevel) => Promise<void>;
}) {
  type Draft = Record<string, Record<AppRole, TablePermissionLevel>>;
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const effective = (tableKey: string, role: AppRole): TablePermissionLevel =>
    draft[tableKey]?.[role]
    ?? tablePermissions[tableKey]?.[role]
    ?? DEFAULT_TABLE_PERMISSIONS[tableKey]?.[role]
    ?? 'view';

  const set = (tableKey: string, role: AppRole, level: TablePermissionLevel) => {
    setDraft(prev => ({
      ...prev,
      [tableKey]: { ...(prev[tableKey] ?? {}), [role]: level },
    }));
  };

  const hasDraft = Object.keys(draft).length > 0;

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(draft).flatMap(([tableKey, roles]) =>
          (Object.entries(roles) as [AppRole, TablePermissionLevel][]).map(
            ([role, level]) => onSave(tableKey, role, level)
          )
        )
      );
      setDraft({});
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="px-6 py-4">
          <p className="text-xs text-muted-foreground mb-4">
            UI-level write permissions per table. This controls whether edit controls appear — DB access is always enforced separately by RLS.
          </p>

          {/* Header row */}
          <div className="grid grid-cols-4 gap-2 mb-2 px-1">
            <span className="text-xs font-medium text-muted-foreground">Table</span>
            {ALL_ROLES.map(r => (
              <span key={r} className="text-xs font-medium text-muted-foreground capitalize text-center">{r}</span>
            ))}
          </div>

          <Separator className="mb-3" />

          <div className="space-y-2">
            {TABLE_KEYS.map(tableKey => (
              <div key={tableKey} className="grid grid-cols-4 gap-2 items-center py-1">
                <span className="text-sm font-mono text-xs">{tableKey}</span>
                {ALL_ROLES.map(role => (
                  <Select
                    key={role}
                    value={effective(tableKey, role)}
                    onValueChange={v => set(tableKey, role, v as TablePermissionLevel)}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="edit">Edit</SelectItem>
                      <SelectItem value="view">View</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                ))}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>

      <div className="px-6 py-4 border-t border-border shrink-0">
        <Button onClick={handleSaveAll} disabled={!hasDraft || saving} className="w-full gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save All Permissions'}
        </Button>
      </div>
    </div>
  );
}
