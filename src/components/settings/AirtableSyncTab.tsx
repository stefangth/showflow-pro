import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, CheckCircle2, KeyRound, Lock, Loader2, AlertCircle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Json } from "@/integrations/supabase/types";

import { fetchCustomFieldDefs, upsertCustomFieldDef } from "@/data/customFields";
import { airtableTypeToCustomType, slugifyKey } from "@/lib/customFields";
import { fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords, fetchAirtableProgramPairs } from "@/data/airtableSchema";
import { buildProgramKey, buildCityKey, type AirtableFieldMap, type ProgramPair, planCityReconciliation, groupDuplicateCities, planProgramImport } from "@/data/airtableMapping";
import { showIdentityLabel } from "@/types";
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions, upsertOrgSetting } from "@/data/settings";
import { fetchAirtableSettings, type AirtableSettings } from "@/data/airtableSettings";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities } from "@/data/cities";
import {
  fetchLatestSyncLog, fetchRecentSyncLogs, fetchUnresolvedRecords, triggerAirtableSyncNow,
  type SyncNowResult,
} from "@/data/airtableSync";
import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "@/data/airtableKey";
import { formatDateDMY } from "@/lib/dates";
import { POLL_INTERVAL_PRESETS, formatInterval, MIN_POLL_INTERVAL_MINUTES } from "@/lib/airtablePoll";
import { airtableFallbackMessage, type FallbackCause } from "@/lib/airtableFallback";

import { StatusHeader } from "./airtable/StatusHeader";
import { ConsoleTabs, type ConsoleTab } from "./airtable/ConsoleTabs";
import { ReadOnlyBanner } from "./airtable/ReadOnlyBanner";
import { SetupWizard } from "./airtable/SetupWizard";
import { OverviewTab } from "./airtable/OverviewTab";
import { MappingTab } from "./airtable/MappingTab";
import { CatalogTab, type CatalogRow } from "./airtable/CatalogTab";
import { ActivityTab } from "./airtable/ActivityTab";
import {
  deriveMode, deriveStatus, deriveKpis, groupHeldCauses, requiredMappedCount,
  type HeldCause,
} from "./airtable/console";

interface Props {
  orgId: string | null;
  /** Capability floor (`configure_airtable`): the console still renders read-only for a
   *  producer without the capability. Admins always pass `false`. */
  readOnly?: boolean;
  /** Capability floor (`trigger_sync`), independent of `readOnly`: whether this user may
   *  fire an on-demand "Sync now". Admins always pass `true`. */
  canTriggerSync?: boolean;
}

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

export function AirtableSyncTab({ orgId, readOnly = false, canTriggerSync = true }: Props) {
  const qc = useQueryClient();
  const canWrite = !readOnly;
  const [airtableKey, setAirtableKey] = useState("");
  const [replacing, setReplacing] = useState(false);

  // Console UI state
  const [tab, setTab] = useState<ConsoleTab>("overview");
  const [openCause, setOpenCause] = useState<string | null>("programs");
  const [manageOpen, setManageOpen] = useState(false);
  // Setup-wizard local token (distinct from the manage-connection replace field).
  const [setupKey, setSetupKey] = useState("");

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

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<AirtableSettings>) => {
      if (!orgId) throw new Error("No active organization");
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
      toast.error("Couldn't save Airtable settings. Your last change wasn't stored.");
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  const syncNow = useMutation({
    mutationFn: () => triggerAirtableSyncNow(supabase, orgId!),
    onSuccess: (res: SyncNowResult) => {
      if (res.orgs_synced > 0 && res.result) {
        toast.success(`Synced: ${res.result.new_dates} new, ${res.result.updated} updated`);
      } else {
        toast.warning("Sync didn't run. Check your Airtable configuration");
      }
      qc.invalidateQueries({ queryKey: ["airtable", "sync-log", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "recent-logs", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "unresolved"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Sync failed"),
  });

  const saveState: "idle" | "saving" | "saved" | "error" =
    saveSettings.isPending ? "saving"
      : saveSettings.isError ? "error"
        : saveSettings.isSuccess ? "saved"
          : "idle";

  const fieldMap = (s.airtable_field_map ?? {}) as AirtableFieldMap;
  const setField = (key: keyof AirtableFieldMap, value: string | null) => {
    const current = (qc.getQueryData<AirtableSettings>(SETTINGS_KEY)?.airtable_field_map ?? {}) as AirtableFieldMap;
    saveSettings.mutate({ airtable_field_map: { ...current, [key]: value } });
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
  const selectedTable = tables.find((t) => t.name === s.airtable_table_name);

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
  const saveKey = useMutation({
    mutationFn: async (value: string) => {
      if (!orgId) throw new Error("No active organization");
      if (!value.trim()) throw new Error("Enter an API key");
      await saveAirtableKey(supabase, orgId, value.trim());
    },
    onSuccess: () => {
      setAirtableKey(""); setSetupKey(""); setReplacing(false);
      qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
      toast.success("Airtable API key saved");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to save Airtable key"),
  });
  const deleteKey = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      await deleteAirtableKey(supabase, orgId);
    },
    onSuccess: () => {
      setAirtableKey(""); setReplacing(false);
      qc.removeQueries({ queryKey: ["airtable", "bases", orgId] });
      qc.removeQueries({ queryKey: ["airtable", "tables", orgId] });
      qc.removeQueries({ queryKey: ["airtable", "linked-records", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
      toast.success("Airtable API key deleted");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to delete Airtable key"),
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

  // Held counts keyed the way each catalog row is keyed, parsed from held-record reasons
  // ("program '<sub>' not linked" / "city '<name>' not linked").
  const heldBySub = new Map<string, number>();
  const heldByCityKey = new Map<string, number>();
  for (const r of heldRecords) {
    const m = /^program '(.*)' not linked$/.exec(r.reason ?? "");
    if (m) { heldBySub.set(m[1], (heldBySub.get(m[1]) ?? 0) + 1); continue; }
    const c = /^city '(.*)' not linked$/.exec(r.reason ?? "");
    if (c) { const k = buildCityKey(c[1]) ?? ""; if (k) heldByCityKey.set(k, (heldByCityKey.get(k) ?? 0) + 1); }
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
      if (rows.length === 0) throw new Error("Already matches a catalog show. It will link on the next sync.");
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { invalidateShows(); toast.success("Show created and linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Create failed"),
  });
  const createOneCity = useMutation({
    mutationFn: async (name: string) => {
      const plan = planCityReconciliation([name], citiesQ.data ?? []);
      if (plan.toLink.length === 0 && plan.toCreate.length === 0) throw new Error("Already matches a catalog city.");
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
      return plan;
    },
    onSuccess: (plan) => { invalidateCities(); toast.success(plan.toCreate.length > 0 ? "City created and linked" : "City linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Create failed"),
  });
  const importPrograms = useMutation({
    mutationFn: async (pairs: ProgramPair[]) => {
      const rows = planProgramImport(pairs, showsQ.data ?? []);
      if (rows.length === 0) throw new Error("Nothing to create. Those options already match catalog shows.");
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { invalidateShows(); toast.success("Created the selected shows"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Create failed"),
  });
  const importCities = useMutation({
    mutationFn: async (names: string[]) => {
      const plan = planCityReconciliation(names, citiesQ.data ?? []);
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
    },
    onSuccess: () => { invalidateCities(); toast.success("Created the selected cities"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Create failed"),
  });
  const linkShow = useMutation({
    mutationFn: ({ showId, key }: { showId: string; key: string }) => linkShowAirtableKey(supabase, showId, key),
    onSuccess: () => { invalidateShows(); toast.success("Linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Link failed"),
  });
  const linkCity = useMutation({
    mutationFn: ({ cityId, key }: { cityId: string; key: string }) => linkCityAirtableKey(supabase, cityId, key),
    onSuccess: () => { invalidateCities(); toast.success("Linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Link failed"),
  });
  const unlinkShow = useMutation({
    mutationFn: (showId: string) => linkShowAirtableKey(supabase, showId, null),
    onSuccess: () => { invalidateShows(); toast.success("Unlinked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Unlink failed"),
  });
  const unlinkCity = useMutation({
    mutationFn: (cityId: string) => linkCityAirtableKey(supabase, cityId, null),
    onSuccess: () => { invalidateCities(); toast.success("Unlinked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Unlink failed"),
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
  const unboundFields = (selectedTable?.fields ?? []).filter(
    (f) => !mappedFieldNames.has(f.name) && !customBySourceField.has(f.name),
  );
  const addCustom = useMutation({
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
      toast.success("Added as custom fields");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Could not add custom fields"),
  });

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
      toast.success("Merged duplicate cities");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Merge failed"),
  });
  const firstDupe = dupeGroups[0];
  const mergeSuggestion = firstDupe
    ? (() => {
      const survivor = survivorFor(firstDupe);
      const survivorName = firstDupe.cities.find((c) => c.id === survivor)?.name ?? firstDupe.cities[0].name;
      const names = firstDupe.cities.map((c) => c.name);
      const losers = firstDupe.cities.filter((c) => c.id !== survivor).map((c) => c.id);
      return {
        title: `${names.join(" and ")} are the same city`,
        description: `Merging keeps ${survivorName}'s bookings, eligibility and producer routing, and removes the other row.`,
        actionLabel: `Merge into ${survivorName}`,
        onMerge: () => mergeMut.mutate({ survivor, losers }),
      };
    })()
    : null;

  // ── Console view-model ───────────────────────────────────────────────────────
  const hasBaseTable = !!s.airtable_base_id && !!s.airtable_table_name;
  const mode = deriveMode({ keyPresent, hasBaseTable, latest });
  const status = deriveStatus(latest, mode);
  const kpis = deriveKpis(latest, s, recent);
  const causes: HeldCause[] = groupHeldCauses(heldRecords);
  const heldCount = latest?.held_count ?? 0;
  const mapped = requiredMappedCount(fieldMap);
  const baseName = bases.find((b) => b.id === baseId)?.name ?? (baseId || "not set");
  const eyebrow = hasBaseTable ? `Airtable · ${baseName} › ${s.airtable_table_name}` : "Airtable";
  const nextRunLabel = kpis.find((k) => k.label === "Next run")?.value ?? "the next run";

  const onFixCause = (cause: HeldCause) => {
    if (cause.category === "unlinked_program") importPrograms.mutate(programRows.filter((r) => !r.linkedId && r.key).map((r) => pairByKey.get(r.key)).filter((p): p is ProgramPair => !!p));
    else if (cause.category === "unlinked_city") importCities.mutate(cityRows.filter((r) => !r.linkedId).map((r) => r.display));
  };
  const onBulkCreate = (kind: "program" | "city", rows: CatalogRow[]) => {
    if (kind === "program") importPrograms.mutate(rows.map((r) => pairByKey.get(r.key)).filter((p): p is ProgramPair => !!p));
    else importCities.mutate(rows.map((r) => r.display));
  };
  const onCreate = (kind: "program" | "city", row: CatalogRow) => {
    if (kind === "program") { const pair = pairByKey.get(row.key); if (pair) createOneProgram.mutate(pair); }
    else createOneCity.mutate(row.display);
  };
  const onLink = (kind: "program" | "city", row: CatalogRow, id: string) => {
    if (kind === "program") linkShow.mutate({ showId: id, key: row.key });
    else linkCity.mutate({ cityId: id, key: row.key });
  };
  const onUnlink = (kind: "program" | "city", id: string) => {
    if (kind === "program") unlinkShow.mutate(id); else unlinkCity.mutate(id);
  };
  const openManage = (replace = false) => { setReplacing(replace); setManageOpen(true); };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!orgId) {
    return <p className="text-sm text-muted-foreground">Select an organization to configure Airtable sync.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {readOnly && <ReadOnlyBanner />}

      {mode === "setup" ? (
        <SetupWizard
          keyValue={setupKey}
          onKeyChange={setSetupKey}
          onSaveKey={() => saveKey.mutate(setupKey)}
          saving={saveKey.isPending}
          canWrite={canWrite}
        />
      ) : (
        <>
          <StatusHeader
            eyebrow={eyebrow}
            status={status}
            kpis={kpis}
            saved={saveState !== "saving" && saveState !== "error"}
            canSyncNow={canTriggerSync && keyPresent && !!s.airtable_sync_enabled}
            syncing={syncNow.isPending}
            onSyncNow={() => syncNow.mutate()}
          />

          <ConsoleTabs
            value={tab}
            onChange={setTab}
            heldCount={heldCount}
            syncEnabled={!!s.airtable_sync_enabled}
            onToggleSync={(v) => saveSettings.mutate({ airtable_sync_enabled: v })}
            canWrite={canWrite}
          />

          {tab === "overview" && (
            <OverviewTab
              showError={mode === "error"}
              errorTitle="The last runs failed"
              errorDetail={status.line}
              onReplaceToken={() => openManage(true)}
              allClear={mode === "healthy" && heldCount === 0}
              attention={causes.length > 0 ? {
                causes,
                heldCount,
                canWrite,
                openCategory: openCause,
                onToggle: (c) => setOpenCause((prev) => (prev === c ? null : c)),
                onFix: onFixCause,
                onOpenCatalog: () => setTab("catalog"),
                onOpenActivity: () => setTab("activity"),
                nextRunLabel,
              } : null}
              connection={{
                token: keyStatusQ.data?.updatedAt ? `Saved ${formatDateDMY(new Date(keyStatusQ.data.updatedAt))}` : "Not set",
                base: baseName,
                tableView: `${s.airtable_table_name || "not set"} · ${s.airtable_view || "Grid view"}`,
                frequency: `Every ${formatInterval(s.airtable_poll_interval_minutes)}`,
              }}
              onManageConnection={() => openManage(false)}
              recentRuns={recent.slice(0, 5)}
              canWrite={canWrite}
            />
          )}

          {tab === "mapping" && (
            selectedTable ? (
              <MappingTab
                tableName={selectedTable.name}
                fields={selectedTable.fields.map((f) => ({ id: f.id, name: f.name }))}
                fieldMap={fieldMap}
                onSetField={setField}
                mapped={mapped.mapped}
                total={mapped.total}
                optionNames={optionNames}
                unboundFields={unboundFields.map((f) => ({ id: f.id, name: f.name, type: f.type }))}
                onAddAllCustom={() => addCustom.mutate(unboundFields.map((f) => ({ name: f.name, type: f.type, options: f.options as Record<string, unknown> | undefined })))}
                canWrite={canWrite}
              />
            ) : (
              <Alert>
                <AlertDescription>
                  Pick a base and table first. Open <button className="underline" onClick={() => openManage(false)}>Manage connection</button> to choose where your shows live.
                </AlertDescription>
              </Alert>
            )
          )}

          {tab === "catalog" && (
            <CatalogTab
              programSource={programSource}
              citySource={citySource}
              programRows={programRows}
              cityRows={cityRows}
              programExisting={programExisting}
              cityExisting={cityExisting}
              onLink={onLink}
              onCreate={onCreate}
              onUnlink={onUnlink}
              onBulkCreate={onBulkCreate}
              merge={mergeSuggestion}
              canWrite={canWrite}
              busy={createOneProgram.isPending || createOneCity.isPending || importPrograms.isPending || importCities.isPending || linkShow.isPending || linkCity.isPending || unlinkShow.isPending || unlinkCity.isPending}
            />
          )}

          {tab === "activity" && <ActivityTab runs={recent} loading={recentQ.isLoading} />}
        </>
      )}

      <ManageConnectionDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        canWrite={canWrite}
        keyPresent={keyPresent}
        keyUpdatedAt={keyStatusQ.data?.updatedAt ?? null}
        replacing={replacing}
        setReplacing={setReplacing}
        airtableKey={airtableKey}
        setAirtableKey={setAirtableKey}
        onSaveKey={() => saveKey.mutate(airtableKey)}
        savingKey={saveKey.isPending}
        onDeleteKey={() => deleteKey.mutate()}
        deletingKey={deleteKey.isPending}
        settings={s}
        onSaveSettings={(patch) => saveSettings.mutate(patch)}
        saveState={saveState}
        schemaState={schemaState}
        fallbackCause={fallbackCause}
        isSchemaPending={isSchemaPending}
        refreshSchema={refreshSchema}
        bases={bases}
        tables={tables}
      />
    </div>
  );
}

// ── Manage-connection dialog (base/table/view/frequency + the Vault key) ────────

function AutosaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  if (state === "saving") return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (state === "saved") return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-primary" /> All changes saved</span>;
  return <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" /> Couldn't save</span>;
}

interface ManageConnectionProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canWrite: boolean;
  keyPresent: boolean;
  keyUpdatedAt: string | null;
  replacing: boolean;
  setReplacing: (v: boolean) => void;
  airtableKey: string;
  setAirtableKey: (v: string) => void;
  onSaveKey: () => void;
  savingKey: boolean;
  onDeleteKey: () => void;
  deletingKey: boolean;
  settings: AirtableSettings;
  onSaveSettings: (patch: Partial<AirtableSettings>) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  schemaState: "idle" | "loading" | "accessible" | "fallback";
  fallbackCause: FallbackCause;
  isSchemaPending: boolean;
  refreshSchema: () => void;
  bases: { id: string; name: string }[];
  tables: { id: string; name: string }[];
}

function ManageConnectionDialog(p: ManageConnectionProps) {
  const s = p.settings;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="font-display">Manage connection</DialogTitle>
            <AutosaveStatus state={p.saveState} />
          </div>
          <DialogDescription>Your Airtable key, the base and table to read, the view, and how often to sync.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* API key */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">Personal access token</Label>
              {p.keyPresent ? (
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Key saved</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-muted-foreground"><KeyRound className="h-3 w-3" /> Not set</Badge>
              )}
              {p.keyPresent && p.keyUpdatedAt && (
                <span className="text-xs text-muted-foreground">updated {formatDateDMY(new Date(p.keyUpdatedAt))}</span>
              )}
            </div>
            {p.keyPresent && !p.replacing ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> ••••••••••</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!p.canWrite} onClick={() => p.setReplacing(true)}>Replace</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={!p.canWrite || p.deletingKey}>
                        <Trash2 className="mr-1 h-4 w-4" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete the Airtable API key?</AlertDialogTitle>
                        <AlertDialogDescription>Sync stops working until a new key is saved. The key is removed from the encrypted vault. This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={p.onDeleteKey}>Delete key</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input type="password" autoComplete="off" placeholder={p.keyPresent ? "Enter a new key…" : "pat… (write-only)"} value={p.airtableKey} disabled={!p.canWrite} onChange={(e) => p.setAirtableKey(e.target.value)} />
                  <Button onClick={p.onSaveKey} disabled={!p.canWrite || p.savingKey}>{p.keyPresent ? "Update" : "Save key"}</Button>
                  {p.keyPresent && p.replacing && (
                    <Button variant="ghost" onClick={() => { p.setReplacing(false); p.setAirtableKey(""); }}>Cancel</Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">Stored encrypted in Vault, never displayed. Needs <span className="font-mono text-xs">data.records:read</span> and <span className="font-mono text-xs">schema.bases:read</span>.</p>
              </>
            )}
          </div>

          {/* Base & table */}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="font-medium">Base and table</Label>
              {p.schemaState === "accessible" && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Schema connected</Badge>}
              {p.schemaState === "fallback" && <Badge variant="outline">Manual mode</Badge>}
              <Button variant="outline" size="sm" className="ml-auto" onClick={p.refreshSchema} disabled={p.isSchemaPending || !p.keyPresent}>
                {p.isSchemaPending ? "Loading…" : "Refresh from Airtable"}
              </Button>
            </div>
            {!p.keyPresent && <p className="text-xs text-muted-foreground">Save a key first to load bases and tables.</p>}
            {p.schemaState === "accessible" ? (
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <Label>Base</Label>
                  <Select value={s.airtable_base_id} onValueChange={(v) => p.onSaveSettings({ airtable_base_id: v, airtable_table_name: "" })} disabled={!p.canWrite}>
                    <SelectTrigger><SelectValue placeholder="Select a base" /></SelectTrigger>
                    <SelectContent>{p.bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Table</Label>
                  <Select value={s.airtable_table_name} onValueChange={(v) => p.onSaveSettings({ airtable_table_name: v })} disabled={!p.tables.length || !p.canWrite}>
                    <SelectTrigger><SelectValue placeholder="Select a table" /></SelectTrigger>
                    <SelectContent>{p.tables.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ) : p.schemaState === "fallback" ? (
              <>
                <Alert><AlertDescription>{airtableFallbackMessage(p.fallbackCause)}</AlertDescription></Alert>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <Label>Airtable base ID</Label>
                    <Input placeholder="app1234567890" defaultValue={s.airtable_base_id} key={`base-${s.airtable_base_id}`} disabled={!p.canWrite} onBlur={(e) => { if (e.target.value !== s.airtable_base_id) p.onSaveSettings({ airtable_base_id: e.target.value, airtable_table_name: "" }); }} />
                  </div>
                  <div className="space-y-2">
                    <Label>Airtable table name</Label>
                    <Input placeholder="Shows" defaultValue={s.airtable_table_name} key={`table-${s.airtable_table_name}`} disabled={!p.canWrite} onBlur={(e) => { if (e.target.value !== s.airtable_table_name) p.onSaveSettings({ airtable_table_name: e.target.value }); }} />
                  </div>
                </div>
              </>
            ) : p.schemaState === "loading" ? (
              <div className="grid grid-cols-1 gap-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : null}
            {p.keyPresent && s.airtable_table_name && (
              <div className="space-y-2">
                <Label>Airtable view (optional)</Label>
                <Input placeholder="Grid view" defaultValue={s.airtable_view} key={`view-${s.airtable_view}`} disabled={!p.canWrite} onBlur={(e) => { const v = e.target.value.trim(); if (v !== s.airtable_view) p.onSaveSettings({ airtable_view: v }); }} />
                <p className="text-xs text-muted-foreground">The sync reads records from this view. Leave blank to read the entire table.</p>
              </div>
            )}
          </div>

          {/* Frequency */}
          <div className="space-y-2 border-t border-border pt-4">
            <Label className="font-medium">Sync frequency</Label>
            <Select value={String(s.airtable_poll_interval_minutes)} onValueChange={(v) => p.onSaveSettings({ airtable_poll_interval_minutes: Number(v) })} disabled={!p.canWrite}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{POLL_INTERVAL_PRESETS.map((preset) => <SelectItem key={preset.value} value={String(preset.value)}>{preset.label}</SelectItem>)}</SelectContent>
            </Select>
            {s.airtable_poll_interval_minutes < 60 && (
              <Alert className="max-w-xl">
                <AlertTitle>Frequent syncs can hit Airtable limits</AlertTitle>
                <AlertDescription>Only pick a frequency under one hour if your Airtable workspace is on a paid plan. Airtable may rate-limit frequent requests, which can cause runs to fail or updates to arrive late.</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
