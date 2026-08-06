import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/features/auth/AuthContext';
import { upsertOrgSetting } from '@/data/settings';
import { resolveEditorRows, type EditorSettingRow } from './orgEditorConfig';
import { canUseEditor } from './editorAccess';
import type { AppRole } from '@/config/app.config';
import { resolveColumnTemplate, pageColumnDefs, COMPUTED_LABELS, customFieldDefToColumnDef, CUSTOM_FIELD_PAGES } from './columnRegistries';
import { fetchCustomFieldDefs, type CustomFieldDefinition } from '@/data/customFields';
import {
  DEFAULT_TABLE_PERMISSIONS,
  type ColumnDef,
  type ColumnTemplate,
  type ColumnTemplates,
  type PageAccessConfig,
  type TablePermissionLevel,
  type TablePermissions,
} from './types';

const EDITOR_MODE_KEY = 'showflow_editor_mode';


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
  getCustomFieldDefs: (entity: string) => CustomFieldDefinition[];
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children }: { children: ReactNode }) {
  const { roles, currentOrg, isSuperAdmin } = useAuth();
  const canEdit = canUseEditor(roles, isSuperAdmin);
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();

  const [isEditorMode, setIsEditorMode] = useState(
    () => canEdit && localStorage.getItem(EDITOR_MODE_KEY) === 'true'
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

  // If the user loses editor access, exit editor mode
  useEffect(() => {
    if (!canEdit && isEditorMode) {
      setIsEditorMode(false);
    }
  }, [canEdit, isEditorMode]);

  // Fetch editor configs — org-scoped (override ?? platform default), keyed by orgId
  const { data: rawSettings, isLoading: isConfigLoading } = useQuery({
    queryKey: ['app-settings', 'editor', orgId],
    queryFn: async () => {
      let q = supabase.from('app_settings').select('key, value, org_id')
        .in('key', ['editor_page_access', 'editor_column_templates', 'editor_table_permissions']);
      q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is('org_id', null);
      const { data } = await q;
      return resolveEditorRows((data ?? []) as EditorSettingRow[]);
    },
    staleTime: 30_000,
  });

  const pageAccess = useMemo<PageAccessConfig>(() => rawSettings?.pageAccess ?? {}, [rawSettings]);
  const columnTemplates = useMemo<ColumnTemplates>(() => rawSettings?.columnTemplates ?? {}, [rawSettings]);
  const tablePermissions = useMemo<TablePermissions>(() => rawSettings?.tablePermissions ?? {}, [rawSettings]);

  const { data: customFieldDefsRaw } = useQuery({
    queryKey: ['custom-field-definitions', orgId],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId }),
  });
  const customFieldDefs = useMemo<CustomFieldDefinition[]>(() => customFieldDefsRaw ?? [], [customFieldDefsRaw]);

  const customDefsForPage = useCallback((pageKey: string): ColumnDef[] => {
    const entity = CUSTOM_FIELD_PAGES[pageKey];
    if (!entity) return [];
    const base = pageColumnDefs(pageKey).length;
    return customFieldDefs
      .filter(d => d.entity === entity)
      .map((d, i) => customFieldDefToColumnDef(d, base + i));
  }, [customFieldDefs]);

  const customLabelByColId = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of customFieldDefs) m.set(`custom.${d.key}`, d.label);
    return m;
  }, [customFieldDefs]);

  const upsertSetting = useCallback(async (key: string, value: unknown) => {
    if (!orgId) throw new Error('No active organization');
    await upsertOrgSetting(supabase, orgId, key, value as Json);
    qc.invalidateQueries({ queryKey: ['app-settings', 'editor', orgId] });
  }, [qc, orgId]);

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
    resolveColumnTemplate(pageKey, role, columnTemplates, customDefsForPage(pageKey)),
    [columnTemplates, customDefsForPage]
  );

  const getColumnDefs = useCallback((pageKey: string): ColumnDef[] =>
    [...pageColumnDefs(pageKey), ...customDefsForPage(pageKey)],
    [customDefsForPage]
  );

  const getCustomFieldDefs = useCallback((entity: string): CustomFieldDefinition[] =>
    customFieldDefs.filter(d => d.entity === entity), [customFieldDefs]);

  const { data: columnDescriptions, error: columnDescriptionsError } = useQuery({
    queryKey: ['columns', 'descriptions'],
    staleTime: Infinity, // schema metadata; sessions pick up changes on hard reload only
    gcTime: Infinity,
    retry: 2,
    placeholderData: {}, // show nameOnly fallback (<100ms flash) rather than undefined on first load
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_column_descriptions');
      if (error) throw error;
      const raw = (data !== null && typeof data === 'object' && !Array.isArray(data))
        ? (data as Record<string, string>)
        : {};
      return raw;
    },
  });

  useEffect(() => {
    if (columnDescriptionsError) {
      console.warn('[editor] get_column_descriptions failed, falling back to bare column names:', columnDescriptionsError.message);
    }
  }, [columnDescriptionsError]);

  const getColumnLabel = useCallback(
    (colId: string) => {
      if (colId in COMPUTED_LABELS) return COMPUTED_LABELS[colId];
      if (customLabelByColId.has(colId)) return customLabelByColId.get(colId)!;
      const dotIdx = colId.indexOf('.');
      const nameOnly = dotIdx !== -1 ? colId.slice(dotIdx + 1) : colId;
      return (columnDescriptions ?? {})[colId] ?? nameOnly;
    },
    [columnDescriptions, customLabelByColId]
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
    getCustomFieldDefs,
  }), [
    isEditorMode,
    isSidePanelOpen,
    pageAccess, columnTemplates, tablePermissions, isConfigLoading,
    savePageAccess, saveColumnTemplate, saveTablePermission,
    getColumnTemplate, getColumnDefs, getTablePermission, getColumnLabel,
    getCustomFieldDefs,
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
    getCustomFieldDefs: ctx.getCustomFieldDefs,
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
