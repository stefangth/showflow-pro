import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Columns, Save } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AppRole } from '@/config/app.config';
import { ROUTES } from '@/config/app.config';
import { useEditor } from './EditorContext';
import {
  DEFAULT_PAGE_ACCESS,
  DEFAULT_TABLE_PERMISSIONS,
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

const TABLE_KEYS = Object.keys(DEFAULT_TABLE_PERMISSIONS);

export function EditorSidePanel({ open, onOpenChange }: EditorSidePanelProps) {
  const location = useLocation();
  const { pageAccess, tablePermissions, savePageAccess, saveTablePermission } = useEditor();

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
            <LayoutTab />
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

function LayoutTab() {
  return (
    <div className="px-6 py-8 flex flex-col items-center justify-center gap-3 text-center">
      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
        <Columns className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Edit columns directly on the page</p>
        <p className="text-xs text-muted-foreground mt-1">
          Navigate to Shows &amp; Bookings or Availability with editor mode on.
          A column bar appears above each table — drag chips to reorder, click the eye to hide.
        </p>
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
