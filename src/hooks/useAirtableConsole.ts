import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

import {
  fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords, fetchAirtableProgramPairs,
  type AirtableBase, type AirtableTable,
} from "@/data/airtableSchema";
import {
  buildProgramKey, buildCityKey, type AirtableFieldMap, type ProgramPair,
  planCityReconciliation, groupDuplicateCities, planProgramImport,
} from "@/data/airtableMapping";
import { showIdentityLabel } from "@/types";
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions, upsertOrgSetting } from "@/data/settings";
import { fetchAirtableSettings, type AirtableSettings } from "@/data/airtableSettings";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities } from "@/data/cities";
import {
  fetchLatestSyncLog, fetchRecentSyncLogs, fetchUnresolvedRecords, triggerAirtableSyncNow,
  type SyncLogSummary, type UnresolvedRecord, type SyncNowResult,
} from "@/data/airtableSync";
import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "@/data/airtableKey";
import { MIN_POLL_INTERVAL_MINUTES } from "@/lib/airtablePoll";
import { type FallbackCause } from "@/lib/airtableFallback";
import { fetchCustomFieldDefs, upsertCustomFieldDef } from "@/data/customFields";
import { airtableTypeToCustomType, slugifyKey } from "@/lib/customFields";

import { type CatalogRow } from "@/components/settings/airtable/CatalogTab";
import {
  deriveMode, deriveStatus, deriveKpis, groupHeldCauses, requiredMappedCount, parseHeldReason,
  type HeldCause, type ConsoleMode, type StatusView, type Kpi,
} from "@/components/settings/airtable/console";

type CatalogKind = "program" | "city";

/** Collapse rows that resolve to the same catalog key so each target shows once. */
function dedupeRowsByKey<T extends { key: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

/** The full return shape of {@link useAirtableConsole}: every query/mutation/derived value the
 *  Airtable console needs, so `AirtableSyncTab` (Settings) and any board-context consumer (the
 *  Get-running Airtable rail/summary, screen 11) can share one data-wiring implementation. */
export interface AirtableConsole {
  canWrite: boolean;
  /** True once the two queries that decide connected-vs-not (key status + settings) have
   *  settled — lets a caller latch a rail-vs-summary mode exactly once instead of
   *  re-deriving it from `keyPresent`/`hasBaseTable` on every render (see
   *  `AirtableConnect`, screen 11). */
  ready: boolean;

  // connection / key
  keyPresent: boolean;
  keyUpdatedAt: string | null;
  /** Fires the "save Airtable PAT" mutation. `onSuccess`, if given, runs in addition to the
   *  hook's own toast + cache invalidation (react-query fires per-call callbacks alongside the
   *  mutation's own) — lets a caller reset its own local UI-only state (e.g. a token input). */
  saveKey: (value: string, onSuccess?: () => void) => void;
  savingKey: boolean;
  deleteKey: (onSuccess?: () => void) => void;
  deletingKey: boolean;

  // settings + autosave
  settings: AirtableSettings;
  saveSettings: (patch: Partial<AirtableSettings>) => void;
  saveState: "idle" | "saving" | "saved" | "error";

  // schema (bases/tables)
  bases: AirtableBase[];
  tables: AirtableTable[];
  schemaState: "idle" | "loading" | "accessible" | "fallback";
  fallbackCause: FallbackCause;
  isSchemaPending: boolean;
  refreshSchema: () => void;
  selectedTable: AirtableTable | undefined;
  baseName: string;

  // field mapping (→ MappingTab)
  fieldMap: AirtableFieldMap;
  setField: (key: keyof AirtableFieldMap, value: string | null) => void;
  mapped: number;
  mappedTotal: number;
  optionNames: (fieldName: string | null | undefined) => string[];
  unboundFields: { id: string; name: string; type: string }[];
  addAllCustom: () => void;
  addingCustom: boolean;

  // catalog (→ CatalogTab)
  programSource: string;
  citySource: string;
  programRows: CatalogRow[];
  cityRows: CatalogRow[];
  programExisting: { id: string; label: string }[];
  cityExisting: { id: string; label: string }[];
  onLink: (kind: CatalogKind, row: CatalogRow, existingId: string) => void;
  onCreate: (kind: CatalogKind, row: CatalogRow) => void;
  onUnlink: (kind: CatalogKind, linkedId: string) => void;
  onBulkCreate: (kind: CatalogKind, rows: CatalogRow[]) => void;
  mergeSuggestion: { title: string; description: string; actionLabel: string; onMerge: () => void } | null;
  catalogBusy: boolean;

  // sync status / history
  latest: SyncLogSummary | null;
  recent: SyncLogSummary[];
  recentLoading: boolean;
  heldRecords: UnresolvedRecord[];
  heldCount: number;
  syncNow: () => void;
  syncing: boolean;
  canTriggerSync: boolean;

  // console view-model (StatusHeader/OverviewTab)
  mode: ConsoleMode;
  hasBaseTable: boolean;
  status: StatusView;
  kpis: Kpi[];
  causes: HeldCause[];
  eyebrow: string;
  nextRunLabel: string;
  onFixCause: (cause: HeldCause) => void;
}

/**
 * Shared data-wiring for the Airtable console: every query, mutation and derived value the
 * Settings `AirtableSyncTab` needs, extracted so the Get-running Airtable connect rail/summary
 * (screen 11) can reuse the exact same logic instead of duplicating it. Behavior-preserving
 * extraction — every query key, mutation, and derivation is copied verbatim from the tab.
 *
 * UI-only local state (which dialog/tab is open, the token `<Input>` draft) is NOT owned here —
 * it stays with whichever component renders the chrome, since it isn't shared data.
 */
export function useAirtableConsole(
  orgId: string | null,
  opts: { readOnly?: boolean; canTriggerSync?: boolean } = {},
): AirtableConsole {
  const { readOnly = false, canTriggerSync = false } = opts;
  const { t } = useTranslation('settingsAirtable');
  const qc = useQueryClient();
  const canWrite = !readOnly;

  // ── API-key presence (status only; the key value is never read back) ─────────
  const keyStatusQ = useQuery({
    queryKey: ["airtable", "key-status", orgId],
    enabled: !!orgId,
    queryFn: () => fetchAirtableKeyStatus(supabase, orgId!),
  });
  const keyPresent = !!keyStatusQ.data?.present;

  // ── Tab-owned settings + optimistic autosave ─────────────────────────────────
  const SETTINGS_KEY = ["airtable", "settings", orgId] as const;
  const settingsQ = useQuery({
    queryKey: SETTINGS_KEY,
    enabled: !!orgId,
    queryFn: () => fetchAirtableSettings(supabase, orgId!),
  });
  const s: AirtableSettings = settingsQ.data ?? {
    airtable_sync_enabled: false, airtable_base_id: "", airtable_table_name: "", airtable_field_map: {}, airtable_view: "Grid view",
    airtable_poll_interval_minutes: MIN_POLL_INTERVAL_MINUTES,
  };

  const saveSettingsMut = useMutation({
    mutationFn: async (patch: Partial<AirtableSettings>) => {
      if (!orgId) throw new Error(t('toasts.noActiveOrg'));
      await Promise.all(
        Object.entries(patch).map(([key, value]) => upsertOrgSetting(supabase, orgId, key, value as Json)),
      );
    },
    onMutate: async (patch: Partial<AirtableSettings>) => {
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const prev = qc.getQueryData<AirtableSettings>(SETTINGS_KEY);
      qc.setQueryData<AirtableSettings>(SETTINGS_KEY, (p) => ({ ...(p ?? s), ...patch }));
      return { prev };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(SETTINGS_KEY, ctx.prev);
      toast.error(t('toasts.settingsSaveError'));
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  const syncNowMut = useMutation({
    mutationFn: () => triggerAirtableSyncNow(supabase, orgId!),
    onSuccess: (res: SyncNowResult) => {
      if (res.orgs_synced > 0 && res.result) {
        toast.success(t('toasts.syncSuccess', { newDates: res.result.new_dates, updated: res.result.updated }));
      } else {
        toast.warning(t('toasts.syncNoRun'));
      }
      qc.invalidateQueries({ queryKey: ["airtable", "sync-log", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "recent-logs", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "unresolved"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (e: Error) => toast.error(e.message ?? t('toasts.syncFailed')),
  });

  const saveState: "idle" | "saving" | "saved" | "error" =
    saveSettingsMut.isPending ? "saving"
      : saveSettingsMut.isError ? "error"
        : saveSettingsMut.isSuccess ? "saved"
          : "idle";

  const fieldMap = (s.airtable_field_map ?? {}) as AirtableFieldMap;
  const setField = (key: keyof AirtableFieldMap, value: string | null) => {
    const current = (qc.getQueryData<AirtableSettings>(SETTINGS_KEY)?.airtable_field_map ?? {}) as AirtableFieldMap;
    saveSettingsMut.mutate({ airtable_field_map: { ...current, [key]: value } });
  };

  // ── Schema (bases + tables) ──────────────────────────────────────────────────
  const baseId = s.airtable_base_id;
  const basesQ = useQuery({
    queryKey: ["airtable", "bases", orgId],
    enabled: !!orgId && keyPresent,
    queryFn: () => fetchAirtableBases(supabase, orgId!),
    staleTime: 5 * 60 * 1000, retry: false,
  });
  const basesAccessible = basesQ.data?.schemaAccessible === true;
  const tablesQ = useQuery({
    queryKey: ["airtable", "tables", orgId, baseId],
    enabled: !!orgId && keyPresent && basesAccessible && !!baseId,
    queryFn: () => fetchAirtableTables(supabase, orgId!, baseId),
    staleTime: 5 * 60 * 1000, retry: false,
  });
  const bases = basesQ.data?.bases ?? [];
  const tables = tablesQ.data?.tables ?? [];

  let schemaState: "idle" | "loading" | "accessible" | "fallback" = "idle";
  let fallbackCause: FallbackCause = "no-scope";
  if (!keyPresent) {
    schemaState = "idle";
  } else if (basesQ.isError) {
    schemaState = "fallback"; fallbackCause = "error";
  } else if (basesQ.isLoading || !basesQ.data) {
    schemaState = "loading";
  } else if (!basesAccessible) {
    schemaState = "fallback"; fallbackCause = "no-scope";
  } else if (baseId && tablesQ.isError) {
    schemaState = "fallback"; fallbackCause = "error";
  } else if (baseId && tablesQ.data && !tablesQ.data.schemaAccessible) {
    schemaState = "fallback"; fallbackCause = "per-base";
  } else {
    schemaState = "accessible";
  }
  const isSchemaPending = basesQ.isFetching || tablesQ.isFetching;
  const refreshSchema = () => { void basesQ.refetch(); if (baseId) void tablesQ.refetch(); };
  const selectedTable = tables.find((tbl) => tbl.name === s.airtable_table_name);

  // City may be a multipleRecordLinks field; enumerate the linked table's records as options.
  const cityField = selectedTable?.fields.find((f) => f.name === fieldMap.city);
  const cityLinkedTableId = cityField?.type === "multipleRecordLinks"
    ? ((cityField.options as { linkedTableId?: string } | undefined)?.linkedTableId ?? null)
    : null;
  const cityLinkedRecordsQ = useQuery({
    queryKey: ["airtable", "linked-records", orgId, baseId, cityLinkedTableId],
    enabled: !!orgId && keyPresent && !!baseId && !!cityLinkedTableId,
    queryFn: () => fetchAirtableLinkedRecords(supabase, orgId!, baseId, cityLinkedTableId!),
    staleTime: 5 * 60 * 1000, retry: false,
  });

  const programPairsQ = useQuery({
    queryKey: ["airtable", "program-pairs", orgId, baseId, s.airtable_table_name, fieldMap.program, fieldMap.sub_program],
    enabled: !!orgId && keyPresent && basesAccessible && !!baseId && !!selectedTable && !!fieldMap.program && !!fieldMap.sub_program,
    queryFn: () => fetchAirtableProgramPairs(supabase, orgId!, baseId, s.airtable_table_name!, fieldMap.sub_program!, fieldMap.program!),
    staleTime: 5 * 60 * 1000, retry: false,
  });

  // ── API key (Vault) ──────────────────────────────────────────────────────────
  const saveKeyMut = useMutation({
    mutationFn: async (value: string) => {
      if (!orgId) throw new Error(t('toasts.noActiveOrg'));
      if (!value.trim()) throw new Error(t('toasts.enterApiKey'));
      await saveAirtableKey(supabase, orgId, value.trim());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
      toast.success(t('toasts.keySaved'));
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.keySaveFailed')),
  });
  const deleteKeyMut = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error(t('toasts.noActiveOrg'));
      await deleteAirtableKey(supabase, orgId);
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["airtable", "bases", orgId] });
      qc.removeQueries({ queryKey: ["airtable", "tables", orgId] });
      qc.removeQueries({ queryKey: ["airtable", "linked-records", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
      toast.success(t('toasts.keyDeleted'));
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.keyDeleteFailed')),
  });

  // ── Catalog data + option resolution ────────────────────────────────────────
  const showsQ = useQuery({ queryKey: ["shows", "linking", orgId], enabled: !!orgId, queryFn: () => fetchShowsForLinking(supabase, orgId) });
  const citiesQ = useQuery({ queryKey: ["cities", "linking", orgId], enabled: !!orgId, queryFn: () => fetchCitiesForLinking(supabase, orgId) });

  // ── Sync history (latest + recent) + held/unresolved ─────────────────────────
  const syncLogQ = useQuery({ queryKey: ["airtable", "sync-log", orgId], enabled: !!orgId, queryFn: () => fetchLatestSyncLog(supabase, orgId) });
  const recentQ = useQuery({ queryKey: ["airtable", "recent-logs", orgId], enabled: !!orgId, queryFn: () => fetchRecentSyncLogs(supabase, orgId, 30) });
  const unresolvedQ = useQuery({
    queryKey: ["airtable", "unresolved", syncLogQ.data?.id ?? null],
    enabled: !!syncLogQ.data?.id,
    queryFn: () => fetchUnresolvedRecords(supabase, syncLogQ.data?.id ?? null),
  });
  const latest = syncLogQ.data ?? null;
  const recent = recentQ.data ?? [];
  const unresolved = unresolvedQ.data ?? [];
  const heldRecords = unresolved.filter((r) => r.action === "held_unresolved");

  const optionNames = (fieldName: string | null | undefined): string[] => {
    if (!fieldName || !selectedTable) return [];
    const f = selectedTable.fields.find((x) => x.name === fieldName);
    const choices = (f?.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? [];
    return choices.map((c) => c.name);
  };

  const programGrainPairs: ProgramPair[] = fieldMap.program
    ? (programPairsQ.data?.pairs ?? [])
    : optionNames(fieldMap.sub_program).map((name) => ({ program: null, sub_program: name }));
  const cityOptions = cityLinkedTableId
    ? (cityLinkedRecordsQ.data?.records ?? []).map((r) => r.name)
    : optionNames(fieldMap.city);

  const showByKey = new Map((showsQ.data ?? []).filter((sh) => sh.airtable_program_key).map((sh) => [sh.airtable_program_key!, sh]));
  const cityByKey = new Map((citiesQ.data ?? []).filter((c) => c.airtable_city_key).map((c) => [c.airtable_city_key!, c]));

  // Held counts keyed the way each catalog row is keyed, from the shared reason parser.
  // Program attribution is keyed by sub-program (all the poll's reason carries); this assumes
  // sub-program is unique across programs, matching planProgramImport's own dedup (ADR-0010).
  const heldBySub = new Map<string, number>();
  const heldByCityKey = new Map<string, number>();
  for (const r of heldRecords) {
    const parsed = parseHeldReason(r.reason);
    if (parsed?.category === "unlinked_program" && parsed.option) {
      heldBySub.set(parsed.option, (heldBySub.get(parsed.option) ?? 0) + 1);
    } else if (parsed?.category === "unlinked_city" && parsed.option) {
      const k = buildCityKey(parsed.option) ?? "";
      if (k) heldByCityKey.set(k, (heldByCityKey.get(k) ?? 0) + 1);
    }
  }

  // ── Import / link / unlink / merge mutations ─────────────────────────────────
  const pairByKey = new Map<string, ProgramPair>();
  for (const pair of programGrainPairs) {
    const key = buildProgramKey(pair.program, pair.sub_program) ?? "";
    if (key) pairByKey.set(key, pair);
  }
  const invalidateShows = () => qc.invalidateQueries({ queryKey: ["shows"] });
  const invalidateCities = () => qc.invalidateQueries({ queryKey: ["cities"] });

  const createOneProgram = useMutation({
    mutationFn: async (pair: ProgramPair) => {
      const rows = planProgramImport([pair], showsQ.data ?? []);
      if (rows.length === 0) throw new Error(t('toasts.alreadyMatchesShow'));
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { invalidateShows(); toast.success(t('toasts.showCreatedAndLinked')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.createFailed')),
  });
  const createOneCity = useMutation({
    mutationFn: async (name: string) => {
      const plan = planCityReconciliation([name], citiesQ.data ?? []);
      if (plan.toLink.length === 0 && plan.toCreate.length === 0) throw new Error(t('toasts.alreadyMatchesCity'));
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
      return plan;
    },
    onSuccess: (plan) => { invalidateCities(); toast.success(plan.toCreate.length > 0 ? t('toasts.cityCreatedAndLinked') : t('toasts.cityLinked')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.createFailed')),
  });
  const importPrograms = useMutation({
    mutationFn: async (pairs: ProgramPair[]) => {
      const rows = planProgramImport(pairs, showsQ.data ?? []);
      if (rows.length === 0) throw new Error(t('toasts.nothingToCreateShows'));
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { invalidateShows(); toast.success(t('toasts.createdSelectedShows')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.createFailed')),
  });
  const importCities = useMutation({
    mutationFn: async (names: string[]) => {
      const plan = planCityReconciliation(names, citiesQ.data ?? []);
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
    },
    onSuccess: () => { invalidateCities(); toast.success(t('toasts.createdSelectedCities')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.createFailed')),
  });
  const linkShowMut = useMutation({
    mutationFn: ({ showId, key }: { showId: string; key: string }) => linkShowAirtableKey(supabase, showId, key),
    onSuccess: () => { invalidateShows(); toast.success(t('toasts.linked')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.linkFailed')),
  });
  const linkCityMut = useMutation({
    mutationFn: ({ cityId, key }: { cityId: string; key: string }) => linkCityAirtableKey(supabase, cityId, key),
    onSuccess: () => { invalidateCities(); toast.success(t('toasts.linked')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.linkFailed')),
  });
  const unlinkShowMut = useMutation({
    mutationFn: (showId: string) => linkShowAirtableKey(supabase, showId, null),
    onSuccess: () => { invalidateShows(); toast.success(t('toasts.unlinked')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.unlinkFailed')),
  });
  const unlinkCityMut = useMutation({
    mutationFn: (cityId: string) => linkCityAirtableKey(supabase, cityId, null),
    onSuccess: () => { invalidateCities(); toast.success(t('toasts.unlinked')); },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.unlinkFailed')),
  });

  const unlinkedShows = (showsQ.data ?? []).filter((sh) => !sh.airtable_program_key);
  const unlinkedCities = (citiesQ.data ?? []).filter((c) => !c.airtable_city_key);
  const programExisting = unlinkedShows.map((sh) => ({ id: sh.id, label: showIdentityLabel(sh) }));
  const cityExisting = unlinkedCities.map((c) => ({ id: c.id, label: c.name }));

  const programSource = fieldMap.program ? `${fieldMap.program} · ${fieldMap.sub_program}` : (fieldMap.sub_program ?? "");
  const citySource = fieldMap.city ?? "";

  const programRows: CatalogRow[] = dedupeRowsByKey(programGrainPairs.map((pair) => {
    const key = buildProgramKey(pair.program, pair.sub_program) ?? "";
    const show = key ? showByKey.get(key) : undefined;
    return {
      key,
      display: showIdentityLabel(pair),
      linkedId: show?.id ?? null,
      linkedLabel: show ? showIdentityLabel(show) : null,
      holdCount: heldBySub.get(pair.sub_program) ?? 0,
    };
  }));
  const cityRows: CatalogRow[] = dedupeRowsByKey(cityOptions.map((name) => {
    const key = buildCityKey(name) ?? "";
    const city = key ? cityByKey.get(key) : undefined;
    return {
      key,
      display: name,
      linkedId: city?.id ?? null,
      linkedLabel: city?.name ?? null,
      holdCount: key ? (heldByCityKey.get(key) ?? 0) : 0,
    };
  }));

  // ── Custom fields (add-only, matching the design) ────────────────────────────
  const customFieldsQ = useQuery({
    queryKey: ["custom-field-definitions", orgId, "show_dates"],
    enabled: !!orgId,
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
  });
  const customDefs = customFieldsQ.data ?? [];
  const customBySourceField = new Set(customDefs.map((d) => d.source_field));
  const mappedFieldNames = new Set(Object.values(fieldMap).filter(Boolean) as string[]);
  const rawUnboundFields = useMemo(
    () => (selectedTable?.fields ?? []).filter(
      (f) => !mappedFieldNames.has(f.name) && !customBySourceField.has(f.name),
    ),
    // rawUnboundFields is derived from selectedTable's fields, the mapped field names (from
    // fieldMap) and the already-custom-defined source fields (from customDefs) — those are the
    // true inputs; mappedFieldNames/customBySourceField are recomputed fresh each render from
    // the same fieldMap/customDefs, so keying on the primitives here is equivalent and stays
    // correct even though the Sets themselves are new objects every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTable, fieldMap, customDefs],
  );
  const addCustomMut = useMutation({
    mutationFn: async (afs: Array<{ name: string; type: string; options?: Record<string, unknown> }>) => {
      for (const af of afs) {
        const key = slugifyKey(af.name);
        if (customDefs.some((d) => d.key === key)) continue; // skip existing keys
        const type = airtableTypeToCustomType(af.type);
        const options = type === "select"
          ? ((af.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? []).map((c) => c.name)
          : null;
        await upsertCustomFieldDef(supabase, {
          org_id: orgId!, entity: "show_dates", key, label: af.name, type, source_field: af.name, options,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-field-definitions", orgId, "show_dates"] });
      qc.invalidateQueries({ queryKey: ["custom-field-definitions", orgId] });
      toast.success(t('toasts.addedAsCustomFields'));
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.addCustomFieldsFailed')),
  });
  const addAllCustom = () => {
    addCustomMut.mutate(rawUnboundFields.map((f) => ({ name: f.name, type: f.type, options: f.options as Record<string, unknown> | undefined })));
  };
  const unboundFields = useMemo(
    () => rawUnboundFields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    [rawUnboundFields],
  );

  // ── Duplicate cities → merge suggestion ──────────────────────────────────────
  const dupeGroups = groupDuplicateCities(citiesQ.data ?? []);
  // Auto-pick the survivor: a linked city wins (keeps its Airtable key), else the first row.
  const survivorFor = (g: { norm: string; cities: { id: string; airtable_city_key: string | null }[] }) =>
    g.cities.find((c) => c.airtable_city_key)?.id ?? g.cities[0].id;
  const mergeMut = useMutation({
    mutationFn: ({ survivor, losers }: { survivor: string; losers: string[] }) => mergeCities(supabase, survivor, losers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cities"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["eligible-artists"] });
      qc.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      toast.success(t('toasts.mergedDuplicateCities'));
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? t('toasts.mergeFailed')),
  });
  const firstDupe = dupeGroups[0];
  const mergeSuggestion = firstDupe
    ? (() => {
      const survivor = survivorFor(firstDupe);
      const survivorName = firstDupe.cities.find((c) => c.id === survivor)?.name ?? firstDupe.cities[0].name;
      const names = firstDupe.cities.map((c) => c.name);
      const losers = firstDupe.cities.filter((c) => c.id !== survivor).map((c) => c.id);
      return {
        title: t('mergeSuggestion.title', { names: names.join(t('mergeSuggestion.joiner')) }),
        description: t('mergeSuggestion.description', { survivorName }),
        actionLabel: t('mergeSuggestion.actionLabel', { survivorName }),
        onMerge: () => mergeMut.mutate({ survivor, losers }),
      };
    })()
    : null;

  // ── Console view-model ───────────────────────────────────────────────────────
  const hasBaseTable = !!s.airtable_base_id && !!s.airtable_table_name;
  const mode = deriveMode({ keyPresent, hasBaseTable, latest });
  const status = deriveStatus(latest, mode, t);
  const kpis = deriveKpis(latest, s, recent, t);
  const causes: HeldCause[] = groupHeldCauses(heldRecords, t);
  const heldCount = latest?.held_count ?? 0;
  const mappedCounts = requiredMappedCount(fieldMap);
  const baseName = bases.find((b) => b.id === baseId)?.name ?? (baseId || t('overview.connection.tableViewFallbackTable'));
  const eyebrow = hasBaseTable
    ? t('eyebrow.connected', { baseName, tableName: s.airtable_table_name })
    : t('eyebrow.default');
  // "Next run" is always the second tile (index 1) outside the error mode, per deriveKpis'
  // fixed layout — matching by index (not the now-translated label) keeps this correct in German.
  const nextRunLabel = (mode !== "error" ? kpis[1]?.value : undefined) ?? t('nextRunFallback');

  // A cause's bulk fix creates only the options that are actually holding records (holdCount > 0),
  // matching the count the cause title shows, not every unlinked option in the catalog.
  const onFixCause = (cause: HeldCause) => {
    if (cause.category === "unlinked_program") importPrograms.mutate(programRows.filter((r) => !r.linkedId && r.key && (r.holdCount ?? 0) > 0).map((r) => pairByKey.get(r.key)).filter((p): p is ProgramPair => !!p));
    else if (cause.category === "unlinked_city") importCities.mutate(cityRows.filter((r) => !r.linkedId && (r.holdCount ?? 0) > 0).map((r) => r.display));
  };
  const onBulkCreate = (kind: CatalogKind, rows: CatalogRow[]) => {
    if (kind === "program") importPrograms.mutate(rows.map((r) => pairByKey.get(r.key)).filter((p): p is ProgramPair => !!p));
    else importCities.mutate(rows.map((r) => r.display));
  };
  const onCreate = (kind: CatalogKind, row: CatalogRow) => {
    if (kind === "program") { const pair = pairByKey.get(row.key); if (pair) createOneProgram.mutate(pair); }
    else createOneCity.mutate(row.display);
  };
  const onLink = (kind: CatalogKind, row: CatalogRow, id: string) => {
    if (kind === "program") linkShowMut.mutate({ showId: id, key: row.key });
    else linkCityMut.mutate({ cityId: id, key: row.key });
  };
  const onUnlink = (kind: CatalogKind, id: string) => {
    if (kind === "program") unlinkShowMut.mutate(id); else unlinkCityMut.mutate(id);
  };

  return {
    canWrite,
    ready: !!orgId && !keyStatusQ.isLoading && !settingsQ.isLoading,

    keyPresent,
    keyUpdatedAt: keyStatusQ.data?.updatedAt ?? null,
    saveKey: (value, onSuccess) => saveKeyMut.mutate(value, { onSuccess }),
    savingKey: saveKeyMut.isPending,
    deleteKey: (onSuccess) => deleteKeyMut.mutate(undefined, { onSuccess }),
    deletingKey: deleteKeyMut.isPending,

    settings: s,
    saveSettings: (patch) => saveSettingsMut.mutate(patch),
    saveState,

    bases,
    tables,
    schemaState,
    fallbackCause,
    isSchemaPending,
    refreshSchema,
    selectedTable,
    baseName,

    fieldMap,
    setField,
    mapped: mappedCounts.mapped,
    mappedTotal: mappedCounts.total,
    optionNames,
    unboundFields,
    addAllCustom,
    addingCustom: addCustomMut.isPending,

    programSource,
    citySource,
    programRows,
    cityRows,
    programExisting,
    cityExisting,
    onLink,
    onCreate,
    onUnlink,
    onBulkCreate,
    mergeSuggestion,
    catalogBusy: createOneProgram.isPending || createOneCity.isPending || importPrograms.isPending || importCities.isPending
      || linkShowMut.isPending || linkCityMut.isPending || unlinkShowMut.isPending || unlinkCityMut.isPending,

    latest,
    recent,
    recentLoading: recentQ.isLoading,
    heldRecords,
    heldCount,
    syncNow: () => { if (canTriggerSync) syncNowMut.mutate(); },
    syncing: syncNowMut.isPending,
    canTriggerSync,

    mode,
    hasBaseTable,
    status,
    kpis,
    causes,
    eyebrow,
    nextRunLabel,
    onFixCause,
  };
}
