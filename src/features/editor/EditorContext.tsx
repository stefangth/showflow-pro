import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import type { AppRole } from '@/config/app.config';
import { resolveColumnTemplate, pageColumnDefs } from './columnRegistries';
import {
  DEFAULT_PAGE_ACCESS,
  DEFAULT_TABLE_PERMISSIONS,
  type ColumnDef,
  type ColumnTemplate,
  type ColumnTemplates,
  type PageAccessConfig,
  type TablePermissionLevel,
  type TablePermissions,
} from './types';

const EDITOR_MODE_KEY = 'showflow_editor_mode';

// Labels for virtual _computed columns — no DB backing, always available regardless of RPC state
const COMPUTED_LABELS: Record<string, string> = {
  '_computed.day': 'Day',
  '_computed.slots': 'Slots',
  '_computed.my_status': 'My status',
  '_computed.blocked': 'Blocked',
};

interface EditorContextType {
  isEditorMode: boolean;
  enableEditorMode: () => void;
  disableEditorMode: () => void;
  isSidePanelOpen: boolean;
  setSidePanelOpen: (open: boolean) => void;
  // Configs
  pageAccess: PageAccessConfig;
  columnTemplates: ColumnTemplates;
  tablePermissions: TablePermissions;
  isConfigLoading: boolean;
  // Save functions
  savePageAccess: (config: PageAccessConfig) => Promise<void>;
  saveColumnTemplate: (pageKey: string, role: AppRole, columns: ColumnTemplate[]) => Promise<void>;
  saveTablePermission: (tableKey: string, role: AppRole, level: TablePermissionLevel) => Promise<void>;
  // Derived helpers
  getColumnTemplate: (pageKey: string, role: AppRole) => ColumnTemplate[];
  getColumnDefs: (pageKey: string) => ColumnDef[];
  getTablePermission: (tableKey: string, role: AppRole) => TablePermissionLevel;
  getColumnLabel: (colId: string) => string;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children }: { children: ReactNode }) {
  const { roles } = useAuth();
  const isRealAdmin = roles.includes('admin');
  const qc = useQueryClient();

  const [isEditorMode, setIsEditorMode] = useState(
    () => isRealAdmin && localStorage.getItem(EDITOR_MODE_KEY) === 'true'
  );
  const [isSidePanelOpen, setSidePanelOpen] = useState(false);

  // Sync localStorage whenever isEditorMode changes
  useEffect(() => {
    if (isEditorMode) {
      localStorage.setItem(EDITOR_MODE_KEY, 'true');
    } else {
      localStorage.removeItem(EDITOR_MODE_KEY);
    }
  }, [isEditorMode]);

  // If the user loses admin role, exit editor mode
  useEffect(() => {
    if (!isRealAdmin && isEditorMode) {
      setIsEditorMode(false);
    }
  }, [isRealAdmin, isEditorMode]);

  // Fetch editor configs — piggybacking on the existing app-settings cache key
  const { data: rawSettings, isLoading: isConfigLoading } = useQuery({
    queryKey: ['app-settings', 'editor'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['editor_page_access', 'editor_column_templates', 'editor_table_permissions']);
      const map = Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
      return {
        pageAccess: (map['editor_page_access'] ?? {}) as PageAccessConfig,
        columnTemplates: (map['editor_column_templates'] ?? {}) as ColumnTemplates,
        tablePermissions: (map['editor_table_permissions'] ?? {}) as TablePermissions,
      };
    },
    staleTime: 30_000,
  });

  const pageAccess = useMemo<PageAccessConfig>(() => rawSettings?.pageAccess ?? {}, [rawSettings]);
  const columnTemplates = useMemo<ColumnTemplates>(() => rawSettings?.columnTemplates ?? {}, [rawSettings]);
  const tablePermissions = useMemo<TablePermissions>(() => rawSettings?.tablePermissions ?? {}, [rawSettings]);

  const upsertSetting = useCallback(async (key: string, value: unknown) => {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['app-settings', 'editor'] });
  }, [qc]);

  const { mutateAsync: mutatePageAccess } = useMutation({
    mutationFn: (config: PageAccessConfig) => upsertSetting('editor_page_access', config),
    onSuccess: () => toast.success('Page access saved'),
    onError: () => toast.error('Failed to save page access'),
  });

  const { mutateAsync: mutateColumnTemplates } = useMutation({
    mutationFn: (templates: ColumnTemplates) => upsertSetting('editor_column_templates', templates),
    onSuccess: () => toast.success('Column template saved'),
    onError: () => toast.error('Failed to save column template'),
  });

  const { mutateAsync: mutateTablePermissions } = useMutation({
    mutationFn: (perms: TablePermissions) => upsertSetting('editor_table_permissions', perms),
    onSuccess: () => toast.success('Permissions saved'),
    onError: () => toast.error('Failed to save permissions'),
  });

  const savePageAccess = useCallback(async (config: PageAccessConfig) => {
    await mutatePageAccess({ ...pageAccess, ...config });
  }, [mutatePageAccess, pageAccess]);

  const saveColumnTemplate = useCallback(async (pageKey: string, role: AppRole, columns: ColumnTemplate[]) => {
    const updated: ColumnTemplates = {
      ...columnTemplates,
      [pageKey]: { ...(columnTemplates[pageKey] ?? {}), [role]: columns },
    };
    await mutateColumnTemplates(updated);
  }, [mutateColumnTemplates, columnTemplates]);

  const saveTablePermission = useCallback(async (tableKey: string, role: AppRole, level: TablePermissionLevel) => {
    const updated: TablePermissions = {
      ...tablePermissions,
      [tableKey]: { ...(tablePermissions[tableKey] ?? {}), [role]: level },
    };
    await mutateTablePermissions(updated);
  }, [mutateTablePermissions, tablePermissions]);

  const getColumnTemplate = useCallback((pageKey: string, role: AppRole): ColumnTemplate[] =>
    resolveColumnTemplate(pageKey, role, columnTemplates),
    [columnTemplates]
  );

  const getColumnDefs = useCallback((pageKey: string): ColumnDef[] =>
    pageColumnDefs(pageKey),
    []
  );

  // Fetch column descriptions from Postgres column comments via RPC.
  // _computed.* columns have no DB backing so they are merged in statically.
  const { data: columnDescriptions } = useQuery({
    queryKey: ['editor', 'column-descriptions'],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_column_descriptions');
      if (error) {
        console.warn('[editor] get_column_descriptions failed, falling back to bare column names:', error.message);
        throw error;
      }
      const raw = data != null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, string>)
        : {};
      return raw;
    },
  });

  const getColumnLabel = useCallback(
    (colId: string) => {
      if (colId in COMPUTED_LABELS) return COMPUTED_LABELS[colId];
      const dotIdx = colId.indexOf('.');
      const nameOnly = dotIdx !== -1 ? colId.slice(dotIdx + 1) : colId;
      return columnDescriptions?.[colId] ?? nameOnly;
    },
    [columnDescriptions]
  );

  const getTablePermission = useCallback((tableKey: string, role: AppRole): TablePermissionLevel => {
    return tablePermissions[tableKey]?.[role]
      ?? DEFAULT_TABLE_PERMISSIONS[tableKey]?.[role]
      ?? 'view';
  }, [tablePermissions]);

  const value = useMemo<EditorContextType>(() => ({
    isEditorMode,
    enableEditorMode: () => setIsEditorMode(true),
    disableEditorMode: () => { setIsEditorMode(false); setSidePanelOpen(false); },
    isSidePanelOpen,
    setSidePanelOpen,
    pageAccess,
    columnTemplates,
    tablePermissions,
    isConfigLoading,
    savePageAccess,
    saveColumnTemplate,
    saveTablePermission,
    getColumnTemplate,
    getColumnDefs,
    getTablePermission,
    getColumnLabel,
  }), [
    isEditorMode,
    isSidePanelOpen,
    pageAccess, columnTemplates, tablePermissions, isConfigLoading,
    savePageAccess, saveColumnTemplate, saveTablePermission,
    getColumnTemplate, getColumnDefs, getTablePermission, getColumnLabel,
  ]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

/** Read-only hook for page components and ProtectedRoute. */
export function useEditorConfig() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorConfig must be used within EditorProvider');
  return {
    isEditorMode: ctx.isEditorMode,
    pageAccess: ctx.pageAccess,
    getColumnTemplate: ctx.getColumnTemplate,
    getColumnDefs: ctx.getColumnDefs,
    getTablePermission: ctx.getTablePermission,
    getColumnLabel: ctx.getColumnLabel,
  };
}

/** Hook to get effective columns for a page table, respecting viewAsRole simulation. */
export function useColumnTemplate(pageKey: string) {
  const { getColumnTemplate } = useEditorConfig();
  const { viewAsRole, roles } = useAuth();

  const effectiveRole: AppRole = viewAsRole
    ?? (roles.includes('admin') ? 'admin' : roles.includes('producer') ? 'producer' : 'artist');

  const resolved = useMemo(
    () => getColumnTemplate(pageKey, effectiveRole),
    [getColumnTemplate, pageKey, effectiveRole]
  );

  const isVisible = useCallback(
    (id: string) => resolved.find(c => c.columnId === id)?.visible ?? true,
    [resolved]
  );

  const visibleCount = resolved.filter(c => c.visible).length;

  return { orderedColumns: resolved, isVisible, visibleCount, activeRole: effectiveRole };
}

/** Hook to check UI-level table permission for the current effective role. */
export function useTablePermission(tableKey: string): TablePermissionLevel {
  const { getTablePermission } = useEditorConfig();
  const { viewAsRole, roles } = useAuth();

  const effectiveRole: AppRole = viewAsRole
    ?? (roles.includes('admin') ? 'admin' : roles.includes('producer') ? 'producer' : 'artist');

  return getTablePermission(tableKey, effectiveRole);
}
