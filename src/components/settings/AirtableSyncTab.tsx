import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Trash2, CheckCircle2, KeyRound, Lock, Loader2, AlertCircle, Plus, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandSeparator } from "@/components/ui/command";
import { fetchCustomFieldDefs, upsertCustomFieldDef, deleteCustomFieldDef } from "@/data/customFields";
import { airtableTypeToCustomType, slugifyKey, type CustomFieldType } from "@/lib/customFields";
import { fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords, fetchAirtableProgramPairs } from "@/data/airtableSchema";
import { SHOWFLOW_FIELDS, buildProgramKey, buildCityKey, planCityReconciliation, groupDuplicateCities, planProgramImport, type AirtableFieldMap, type ProgramPair } from "@/data/airtableMapping";
import { showIdentityLabel } from "@/types";
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions, upsertOrgSetting } from "@/data/settings";
import { fetchAirtableSettings, type AirtableSettings } from "@/data/airtableSettings";
import type { Json } from "@/integrations/supabase/types";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities } from "@/data/cities";
import { fetchLatestSyncLog, fetchUnresolvedRecords, triggerAirtableSyncNow, type UnresolvedRecord, type SyncNowResult } from "@/data/airtableSync";
import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "@/data/airtableKey";
import { formatDateDMY } from "@/lib/dates";
import { POLL_INTERVAL_PRESETS, formatInterval, nextSyncAt, MIN_POLL_INTERVAL_MINUTES } from "@/lib/airtablePoll";
import { airtableFallbackMessage, type FallbackCause } from "@/lib/airtableFallback";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Props {
  orgId: string | null;
  /** Capability floor (`configure_airtable`): the org's mapping/keys/catalog links still
   *  render, but a producer without the capability can't change them. Admins always
   *  pass `false` here. */
  readOnly?: boolean;
  /** Capability floor (`trigger_sync`), independent of `readOnly`: whether this user may
   *  fire an on-demand "Sync now". Admins always pass `true`. */
  canTriggerSync?: boolean;
}

/** shadcn Select cannot use "" as an item value, so "not mapped" needs a sentinel. */
const NONE = "__none__";

function AutosaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  if (state === "saving")
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (state === "saved")
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-primary" /> All changes saved</span>;
  return <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" /> Couldn't save</span>;
}

/** One catalog row: the Airtable option, its link status, and the action control. */
interface CatalogRow {
  /** Stable key + the value the link key is built from. */
  key: string;
  /** What the user sees for this Airtable option. */
  display: string;
  /** The linked catalog entity, or null when unlinked. */
  linkedId: string | null;
  linkedLabel: string | null;
  /** Program rows only: the source pair, so onCreate imports it without a key→pair lookup. */
  createPair?: ProgramPair;
}

/** Collapse rows that resolve to the same catalog key — e.g. two linked-table records both named
 *  "Berlin", or "Berlin"/"berlin" — so each catalog target shows once and row.key is a unique
 *  React list key. Keeps the first occurrence's display. */
function dedupeRowsByKey(rows: CatalogRow[]): CatalogRow[] {
  const seen = new Set<string>();
  const out: CatalogRow[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

/** Per-row "smart" combobox: search existing catalog rows to link, or create a new catalog
 *  entry for this Airtable option. Shared by the Programs and Cities tables. */
function CatalogLinkCombobox({
  optionLabel, existing, onCreate, onLink, disabled, ariaLabel, searchPlaceholder,
}: {
  optionLabel: string;
  existing: { id: string; label: string }[];
  onCreate: () => void;
  onLink: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const matches = existing.filter((e) => e.label.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-full sm:w-[240px] justify-between" aria-label={ariaLabel} disabled={disabled}>
          <span className="truncate text-muted-foreground">Link or create…</span>
          <ChevronsUpDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="end">
        {/* Manual filtering (shouldFilter=false) so the Create row is always offered. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandGroup>
              {/* Radix doesn't fire onOpenChange for a programmatic close, so clear search here too. */}
              <CommandItem value="__create__" onSelect={() => { onCreate(); setOpen(false); setSearch(""); }}>
                <Plus className="h-4 w-4 mr-2" /> Create &ldquo;{optionLabel}&rdquo;
              </CommandItem>
            </CommandGroup>
            {matches.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Link to existing">
                  {matches.map((e) => (
                    <CommandItem key={e.id} value={e.id} onSelect={() => { onLink(e.id); setOpen(false); setSearch(""); }}>
                      {e.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {matches.length === 0 && search.trim() !== "" && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No existing matches.</p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One catalog section (Programs or Cities): header with a dynamic source-field subtitle +
 *  bulk import, then a tabular list with a status pill and per-row link/create combobox. */
function CatalogSection({
  title, sourceLabel, rows, unlinkedCount, importAll, importDisabled,
  existing, onCreate, onLink, onUnlink, entityNoun, emptyHint, busy, readOnly,
}: {
  title: string;
  sourceLabel: string;
  rows: CatalogRow[];
  unlinkedCount: number;
  importAll: () => void;
  importDisabled: boolean;
  existing: { id: string; label: string }[];
  onCreate: (row: CatalogRow) => void;
  onLink: (row: CatalogRow, id: string) => void;
  onUnlink: (id: string) => void;
  entityNoun: "show" | "city"; // used in aria-labels + search placeholders
  emptyHint: string;
  busy?: boolean; // a link/create/unlink mutation (or the backing catalog query) is in flight
  readOnly?: boolean; // capability floor: link/create/unlink/import controls disabled
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display font-semibold">{title}</h4>
          <p className="text-xs text-muted-foreground truncate">from {sourceLabel}</p>
        </div>
        <Button variant="outline" size="sm" onClick={importAll} disabled={importDisabled || readOnly}>
          Import all unlinked{unlinkedCount ? ` (${unlinkedCount})` : ""}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="rounded-md border border-border">
          <div className="hidden sm:grid grid-cols-[1fr_110px_240px] gap-3 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b border-border">
            <span>Airtable option</span><span>Status</span><span>Catalog link</span>
          </div>
          {rows.map((row) => (
            // row.key is unique per row (rows are deduped by key upstream), so it's a safe list key.
            <div key={row.key} className="grid grid-cols-1 sm:grid-cols-[1fr_110px_240px] gap-2 sm:gap-3 items-center px-3 py-2.5 border-b border-border last:border-b-0">
              <span className="text-sm font-medium truncate">{row.display}</span>
              <div><Badge variant={row.linkedId ? "secondary" : "outline"}>{row.linkedId ? "Linked" : "Unlinked"}</Badge></div>
              <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
                {row.linkedId ? (
                  <>
                    <span className="text-sm text-muted-foreground truncate">→ {row.linkedLabel}</span>
                    <Button size="sm" variant="ghost" className="shrink-0" disabled={busy || readOnly} onClick={() => onUnlink(row.linkedId!)}>Unlink</Button>
                  </>
                ) : row.key ? (
                  <CatalogLinkCombobox
                    optionLabel={row.display}
                    existing={existing}
                    onCreate={() => onCreate(row)}
                    onLink={(id) => onLink(row, id)}
                    disabled={busy || readOnly}
                    ariaLabel={`link or create ${entityNoun} for ${row.display}`}
                    searchPlaceholder={`Search ${entityNoun}s…`}
                  />
                ) : (
                  // No usable link key (blank source value) — never offer linking; a blank key
                  // would otherwise match every unresolved record in the poll.
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AirtableSyncTab({ orgId, readOnly = false, canTriggerSync = true }: Props) {
  const qc = useQueryClient();
  const [airtableKey, setAirtableKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [survivorByNorm, setSurvivorByNorm] = useState<Record<string, string>>({});

  // ── API-key presence (status only; the key value is never read back) ─────────
  const keyStatusQ = useQuery({
    queryKey: ["airtable", "key-status", orgId],
    enabled: !!orgId,
    queryFn: () => fetchAirtableKeyStatus(supabase, orgId!),
  });
  const keyPresent = !!keyStatusQ.data?.present;

  // ── Tab-owned settings + optimistic autosave (decoupled from the page draft) ──
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
      // Each key is an independent (org_id,key) upsert — write them in parallel.
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
      // Reconcile against the DB only when we rolled back: an overlapping save may have
      // snapshotted (then reverted) a different key's successful write. A clean success
      // needs no refetch — its optimistic cache already matches the DB.
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  // "Sync now" — an immediate, single-org poll bypassing the interval gate. The edge fn
  // returns HTTP 200 with `orgs_synced: 0, result: null` when the org is disabled/misconfigured
  // (it did NOT sync) — that must not read as success, so branch on `result` being present.
  const syncNow = useMutation({
    mutationFn: () => triggerAirtableSyncNow(supabase, orgId!),
    onSuccess: (res: SyncNowResult) => {
      if (res.orgs_synced > 0 && res.result) {
        toast.success(`Synced: ${res.result.new_dates} new, ${res.result.updated} updated`);
      } else {
        toast.warning("Sync didn't run. Check your Airtable configuration below");
      }
      qc.invalidateQueries({ queryKey: ["airtable", "sync-log", orgId] });
      // Prefix match: the unresolved query is keyed by the sync-log id, not orgId.
      qc.invalidateQueries({ queryKey: ["airtable", "unresolved"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Sync failed"),
  });

  // Derive the status pill from the mutation itself. A single shared useState would let a
  // late onSuccess from one in-flight save overwrite a newer save's error (and vice versa);
  // React Query tracks the latest mutation's lifecycle correctly.
  const saveState: "idle" | "saving" | "saved" | "error" =
    saveSettings.isPending ? "saving"
      : saveSettings.isError ? "error"
        : saveSettings.isSuccess ? "saved"
          : "idle";

  const fieldMap = (s.airtable_field_map ?? {}) as AirtableFieldMap;
  // Spread the live (optimistically-updated) cache, not the render-time `fieldMap`, so two
  // rapid field changes before a re-render flush don't drop the first one's value.
  const setField = (key: keyof AirtableFieldMap, value: string | null) => {
    const current = (qc.getQueryData<AirtableSettings>(SETTINGS_KEY)?.airtable_field_map ?? {}) as AirtableFieldMap;
    saveSettings.mutate({ airtable_field_map: { ...current, [key]: value } });
  };

  // ── Schema (bases + tables): cached React Query so it survives tab unmount/remount.
  //    Auto-loads when a key is present — no manual "Load" click needed to see mappings.
  const baseId = s.airtable_base_id;

  const basesQ = useQuery({
    queryKey: ["airtable", "bases", orgId],
    enabled: !!orgId && keyPresent,
    queryFn: () => fetchAirtableBases(supabase, orgId!),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const basesAccessible = basesQ.data?.schemaAccessible === true;

  const tablesQ = useQuery({
    queryKey: ["airtable", "tables", orgId, baseId],
    enabled: !!orgId && keyPresent && basesAccessible && !!baseId,
    queryFn: () => fetchAirtableTables(supabase, orgId!, baseId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const bases = basesQ.data?.bases ?? [];
  const tables = tablesQ.data?.tables ?? [];

  // Derive the UI mode from the query states (was imperative setState before).
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

  // City may be a multipleRecordLinks field; if so, enumerate the linked table's records as options.
  const cityField = selectedTable?.fields.find((f) => f.name === fieldMap.city);
  const cityLinkedTableId = cityField?.type === "multipleRecordLinks"
    ? ((cityField.options as { linkedTableId?: string } | undefined)?.linkedTableId ?? null)
    : null;
  const cityLinkedRecordsQ = useQuery({
    queryKey: ["airtable", "linked-records", orgId, baseId, cityLinkedTableId],
    enabled: !!orgId && keyPresent && !!baseId && !!cityLinkedTableId,
    queryFn: () => fetchAirtableLinkedRecords(supabase, orgId!, baseId, cityLinkedTableId!),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // When Program is mapped, link at the composite grain: read distinct (program, sub_program)
  // pairs from records so the UI builds the SAME key the poll does (ADR-0010).
  const programPairsQ = useQuery({
    queryKey: ["airtable", "program-pairs", orgId, baseId, s.airtable_table_name, fieldMap.program, fieldMap.sub_program],
    enabled: !!orgId && keyPresent && basesAccessible && !!baseId && !!selectedTable && !!fieldMap.program && !!fieldMap.sub_program,
    queryFn: () => fetchAirtableProgramPairs(supabase, orgId!, baseId, s.airtable_table_name!, fieldMap.sub_program!, fieldMap.program!),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // ── API key (Vault) + schema loading ────────────────────────────────────────
  const saveKey = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      if (!airtableKey.trim()) throw new Error("Enter an API key");
      await saveAirtableKey(supabase, orgId, airtableKey.trim());
    },
    onSuccess: () => {
      setAirtableKey(""); setReplacing(false);
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

  // ── Last sync report ────────────────────────────────────────────────────────
  const syncLogQ = useQuery({ queryKey: ["airtable", "sync-log", orgId], enabled: !!orgId, queryFn: () => fetchLatestSyncLog(supabase, orgId) });
  const unresolvedQ = useQuery({
    queryKey: ["airtable", "unresolved", syncLogQ.data?.id ?? null],
    enabled: !!syncLogQ.data?.id,
    queryFn: () => fetchUnresolvedRecords(supabase, syncLogQ.data?.id ?? null),
  });
  const recordUrl = (recId: string) => (baseId ? `https://airtable.com/${baseId}/${recId}` : undefined);
  const unresolved = unresolvedQ.data ?? [];
  const heldRecords = unresolved.filter((r) => r.action === "held_unresolved");
  const erroredRecords = unresolved.filter((r) => r.action === "error");
  const renderRecordRow = (r: UnresolvedRecord) => (
    <div key={r.id} className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{r.reason ?? "Unresolved"}</div>
        <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
      </div>
      {r.airtable_record_id && (
        recordUrl(r.airtable_record_id)
          ? <a className="text-xs underline shrink-0" href={recordUrl(r.airtable_record_id)} target="_blank" rel="noreferrer">{r.airtable_record_id}</a>
          : <span className="text-xs text-muted-foreground shrink-0">{r.airtable_record_id}</span>
      )}
    </div>
  );

  /** Distinct option names from a mapped singleSelect field. */
  const optionNames = (fieldName: string | null | undefined): string[] => {
    if (!fieldName || !selectedTable) return [];
    const f = selectedTable.fields.find((x) => x.name === fieldName);
    const choices = (f?.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? [];
    return choices.map((c) => c.name);
  };

  // Composite grain when Program is mapped (pairs from records); else sub-program-only options.
  const programGrainPairs: ProgramPair[] = fieldMap.program
    ? (programPairsQ.data?.pairs ?? [])
    : optionNames(fieldMap.sub_program).map((name) => ({ program: null, sub_program: name }));
  const cityOptions = cityLinkedTableId
    ? (cityLinkedRecordsQ.data?.records ?? []).map((r) => r.name)
    : optionNames(fieldMap.city);

  const showByKey = new Map((showsQ.data ?? []).filter((s) => s.airtable_program_key).map((s) => [s.airtable_program_key!, s]));
  const cityByKey = new Map((citiesQ.data ?? []).filter((c) => c.airtable_city_key).map((c) => [c.airtable_city_key!, c]));

  // ── Import / unlink mutations ───────────────────────────────────────────────
  const importPrograms = useMutation({
    mutationFn: async () => {
      const rows = planProgramImport(programGrainPairs, showsQ.data ?? []);
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Imported program options"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Import failed"),
  });
  const importCities = useMutation({
    mutationFn: async () => {
      const plan = planCityReconciliation(cityOptions, citiesQ.data ?? []);
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("Imported city options"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Import failed"),
  });
  // Per-element import: create a single catalog show/city for one Airtable option (reuses the
  // same pure planners as "Import all", just over a one-element list).
  const createOneProgram = useMutation({
    mutationFn: async (pair: ProgramPair) => {
      const rows = planProgramImport([pair], showsQ.data ?? []);
      // Empty plan = the option is already covered by an existing/legacy catalog show; creating
      // nothing must not report success. (A legacy sub-only-keyed show auto-links on the next sync.)
      if (rows.length === 0) throw new Error("Already matches a catalog show. It will link on the next sync.");
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Show created and linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Create failed"),
  });
  const createOneCity = useMutation({
    mutationFn: async (name: string) => {
      const plan = planCityReconciliation([name], citiesQ.data ?? []);
      // Empty plan = already reconciled to a catalog city; don't report a false "created".
      if (plan.toLink.length === 0 && plan.toCreate.length === 0) throw new Error("Already matches a catalog city.");
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
      return plan;
    },
    onSuccess: (plan) => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success(plan.toCreate.length > 0 ? "City created and linked" : "City linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Create failed"),
  });
  const unlinkShow = useMutation({
    mutationFn: (showId: string) => linkShowAirtableKey(supabase, showId, null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Unlinked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Unlink failed"),
  });
  const unlinkCity = useMutation({
    mutationFn: (cityId: string) => linkCityAirtableKey(supabase, cityId, null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("Unlinked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Unlink failed"),
  });
  const linkCity = useMutation({
    mutationFn: ({ cityId, key }: { cityId: string; key: string }) => linkCityAirtableKey(supabase, cityId, key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("Linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Link failed"),
  });
  const linkShow = useMutation({
    mutationFn: ({ showId, key }: { showId: string; key: string }) => linkShowAirtableKey(supabase, showId, key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Link failed"),
  });
  const unlinkedShows = (showsQ.data ?? []).filter((sh) => !sh.airtable_program_key);
  const unlinkedCities = (citiesQ.data ?? []).filter((c) => !c.airtable_city_key);

  // ── Catalog-link table rows (status + the key the link is built on) ──────────
  // Source-field subtitles name the actual mapped Airtable field(s), not a hardcoded label.
  const programSource = fieldMap.program ? `${fieldMap.program} · ${fieldMap.sub_program}` : (fieldMap.sub_program ?? "");
  const citySource = fieldMap.city ?? "";
  // Each program row carries its source pair (onCreate needs no key→pair map). Rows are deduped by
  // catalog key so each target shows once and row.key is a unique, collision-free React list key.
  const programRows: CatalogRow[] = dedupeRowsByKey(programGrainPairs.map((pair) => {
    // Fall back to "" (not the raw value) so a whitespace-only option yields a falsy key — the
    // poll's buildProgramKey would resolve such a record to null, so linking a " " key never matches.
    const key = buildProgramKey(pair.program, pair.sub_program) ?? "";
    const show = key ? showByKey.get(key) : undefined;
    return {
      key,
      display: showIdentityLabel(pair),
      linkedId: show?.id ?? null,
      linkedLabel: show ? showIdentityLabel(show) : null,
      createPair: pair,
    };
  }));
  const cityRows: CatalogRow[] = dedupeRowsByKey(cityOptions.map((name) => {
    // "" fallback (not the raw name) so a whitespace-only option is falsy and offers no link —
    // consistent with the program rows and with the poll's clean()-based key derivation.
    const key = buildCityKey(name) ?? "";
    const city = key ? cityByKey.get(key) : undefined;
    return { key, display: name, linkedId: city?.id ?? null, linkedLabel: city?.name ?? null };
  }));
  const programExisting = unlinkedShows.map((sh) => ({ id: sh.id, label: showIdentityLabel(sh) }));
  const cityExisting = unlinkedCities.map((c) => ({ id: c.id, label: c.name }));
  const programUnlinked = programRows.filter((r) => !r.linkedId).length;
  const cityUnlinked = cityRows.filter((r) => !r.linkedId).length;

  // ── Custom fields (definitions table; immediate mutations, not the settings draft) ──
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

  const invalidateCustom = () => {
    qc.invalidateQueries({ queryKey: ["custom-field-definitions", orgId, "show_dates"] });
    qc.invalidateQueries({ queryKey: ["custom-field-definitions", orgId] }); // editor's query
  };
  const addCustom = useMutation({
    mutationFn: (af: { name: string; type: string; options?: Record<string, unknown> }) => {
      const type = airtableTypeToCustomType(af.type);
      const options = type === "select"
        ? ((af.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? []).map((c) => c.name)
        : null;
      return upsertCustomFieldDef(supabase, {
        org_id: orgId!, entity: "show_dates", key: slugifyKey(af.name), label: af.name,
        type, source_field: af.name, options,
      });
    },
    onSuccess: () => { invalidateCustom(); toast.success("Custom field added"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Could not add custom field"),
  });
  const setCustomType = useMutation({
    mutationFn: (args: { def: (typeof customDefs)[number]; type: CustomFieldType }) =>
      upsertCustomFieldDef(supabase, {
        org_id: orgId!, entity: "show_dates", key: args.def.key, label: args.def.label,
        type: args.type, source_field: args.def.source_field,
        options: args.def.options, filterable: args.def.filterable, sortable: args.def.sortable,
      }),
    onSuccess: () => { invalidateCustom(); toast.success("Updated"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Update failed"),
  });
  const removeCustom = useMutation({
    mutationFn: (id: string) => deleteCustomFieldDef(supabase, id),
    onSuccess: () => { invalidateCustom(); toast.success("Removed"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Remove failed"),
  });
  const CUSTOM_TYPES: CustomFieldType[] = ["text", "number", "date", "boolean", "select"];

  const dupeGroups = groupDuplicateCities(citiesQ.data ?? []);
  const survivorFor = (g: { norm: string; cities: { id: string; airtable_city_key: string | null }[] }) =>
    survivorByNorm[g.norm] ?? (g.cities.find((c) => c.airtable_city_key)?.id ?? g.cities[0].id);
  const mergeMut = useMutation({
    mutationFn: ({ survivor, losers }: { survivor: string; losers: string[] }) => mergeCities(supabase, survivor, losers),
    onSuccess: () => {
      // merge_cities repoints city_id on show_dates + show_cast_eligibility, so bust every
      // cache that reads those: cities, bookings, and the eligibility-derived queries.
      qc.invalidateQueries({ queryKey: ["cities"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["eligible-artists"] });
      qc.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      toast.success("Merged duplicate cities");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Merge failed"),
  });

  return (
    <div className="space-y-6">
      {/* ── Connection ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="font-display">Airtable Sync</CardTitle>
              <CardDescription>
                Pull show schedules from Airtable on a schedule. Follow the steps below: save your API key, load the base &amp; table, then map fields and link your catalog. Changes save automatically. Sync runs every few minutes once enabled.
              </CardDescription>
            </div>
            <AutosaveStatus state={saveState} />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Enable Airtable sync</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Turn polling on or off globally.</p>
            </div>
            <Switch checked={!!s.airtable_sync_enabled} disabled={readOnly} onCheckedChange={(v) => saveSettings.mutate({ airtable_sync_enabled: v })} />
          </div>

          {/* Poll interval + cadence transparency */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1.5">
              <Label className="font-medium">Sync frequency</Label>
              <Select
                value={String(s.airtable_poll_interval_minutes)}
                onValueChange={(v) => saveSettings.mutate({ airtable_poll_interval_minutes: Number(v) })}
                disabled={readOnly}
              >
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POLL_INTERVAL_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Shorter = fresher data but more Airtable API calls (Airtable allows ~5 requests/sec per base)
                and more writes each cycle. Runs on the shared 5-minute cycle.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Button
                variant="outline" size="sm"
                disabled={!s.airtable_sync_enabled || !keyPresent || syncNow.isPending || !canTriggerSync}
                onClick={() => syncNow.mutate()}
              >
                {syncNow.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <p className="text-xs text-muted-foreground text-right">
                {(() => {
                  const last = syncLogQ.data?.synced_at ?? null;
                  if (!last) return "Not synced yet. Runs on the next cycle.";
                  const next = nextSyncAt(last, s.airtable_poll_interval_minutes);
                  const lastStr = new Date(last).toLocaleString();
                  const nextStr = next ? next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
                  return `Last synced ${lastStr} · next ~${nextStr} (every ${formatInterval(s.airtable_poll_interval_minutes)})`;
                })()}
              </p>
            </div>
          </div>

          {!!s.airtable_sync_enabled && !keyStatusQ.isLoading && !keyPresent && (
            <Alert variant="destructive">
              <AlertDescription>Sync is on but no API key is saved. The poll can't run until you add a key below.</AlertDescription>
            </Alert>
          )}

          <Separator />

          {/* Step 1 — API key (write-only: stored in Vault, never read back into the UI) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">1</span>
              <Label className="font-medium">API key</Label>
              {keyStatusQ.isLoading ? null : keyPresent ? (
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Key saved</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-muted-foreground"><KeyRound className="h-3 w-3" /> Not set</Badge>
              )}
              {keyPresent && keyStatusQ.data?.updatedAt && (
                <span className="text-xs text-muted-foreground">updated {formatDateDMY(new Date(keyStatusQ.data.updatedAt))}</span>
              )}
            </div>

            {keyPresent && !replacing ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> ••••••••••</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={readOnly} onClick={() => setReplacing(true)}>Replace</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={readOnly || deleteKey.isPending}>
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
                        <AlertDialogAction onClick={() => deleteKey.mutate()}>Delete key</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input id="airtable-key" type="password" autoComplete="off" placeholder={keyPresent ? "Enter a new key…" : "key… (write-only)"} value={airtableKey} disabled={readOnly} onChange={(e) => setAirtableKey(e.target.value)} />
                  <Button onClick={() => saveKey.mutate()} disabled={readOnly || saveKey.isPending}>{keyPresent ? "Update" : "Save key"}</Button>
                  {keyPresent && replacing && (
                    <Button variant="ghost" onClick={() => { setReplacing(false); setAirtableKey(""); }}>Cancel</Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">Stored encrypted in Vault; never displayed. Required for Airtable sync.</p>
              </>
            )}
          </div>

          <Separator />

          {/* Step 2 — base & table */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">2</span>
              <Label className="font-medium">Base &amp; table</Label>
              {schemaState === "accessible" && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Schema connected</Badge>}
              {schemaState === "fallback" && <Badge variant="outline">Manual mode</Badge>}
            </div>
            <Button variant="outline" onClick={refreshSchema} disabled={isSchemaPending || !orgId || !keyPresent}>
              {isSchemaPending ? "Loading…" : "Refresh from Airtable"}
            </Button>
            {!keyPresent && <p className="text-xs text-muted-foreground">Save an API key first to load bases &amp; tables.</p>}
            {schemaState === "accessible" ? (
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Base</Label>
                  <Select value={s.airtable_base_id} onValueChange={(v) => saveSettings.mutate({ airtable_base_id: v, airtable_table_name: "" })} disabled={readOnly}>
                    <SelectTrigger><SelectValue placeholder="Select a base" /></SelectTrigger>
                    <SelectContent>{bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Table</Label>
                  <Select value={s.airtable_table_name} onValueChange={(v) => saveSettings.mutate({ airtable_table_name: v })} disabled={!tables.length || readOnly}>
                    <SelectTrigger><SelectValue placeholder="Select a table" /></SelectTrigger>
                    <SelectContent>{tables.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ) : schemaState === "fallback" ? (
              <>
                <Alert>
                  <AlertDescription>{airtableFallbackMessage(fallbackCause)}</AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label>Airtable base ID</Label>
                    <Input placeholder="app1234567890" defaultValue={s.airtable_base_id} key={`base-${s.airtable_base_id}`} disabled={readOnly} onBlur={(e) => { if (e.target.value !== s.airtable_base_id) saveSettings.mutate({ airtable_base_id: e.target.value, airtable_table_name: "" }); }} />
                  </div>
                  <div className="space-y-2">
                    <Label>Airtable table name</Label>
                    <Input placeholder="Shows" defaultValue={s.airtable_table_name} key={`table-${s.airtable_table_name}`} disabled={readOnly} onBlur={(e) => { if (e.target.value !== s.airtable_table_name) saveSettings.mutate({ airtable_table_name: e.target.value }); }} />
                  </div>
                </div>
              </>
            ) : schemaState === "loading" ? (
              <div className="grid grid-cols-1 gap-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : null}
            {keyPresent && s.airtable_table_name && (
              <div className="space-y-2">
                <Label>Airtable view (optional)</Label>
                <Input
                  placeholder="Grid view"
                  defaultValue={s.airtable_view}
                  key={`view-${s.airtable_view}`}
                  disabled={readOnly}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== s.airtable_view) saveSettings.mutate({ airtable_view: v }); }}
                />
                <p className="text-xs text-muted-foreground">
                  The sync reads records from this Airtable view. Leave blank to read the entire table. Defaults to &ldquo;Grid view&rdquo;.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Field mapping ──────────────────────────────────────────────────── */}
      {selectedTable && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="font-display">3 · Field mapping</CardTitle>
              <AutosaveStatus state={saveState} />
            </div>
            <CardDescription>
              Map each ShowFlow field to a column in <strong>{selectedTable.name}</strong>. Catalog links are keyed on the <strong>Sub-program</strong> option: map the Sub-program field to enable linking below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="hidden sm:grid grid-cols-[160px_1fr] gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Showflow field</span>
              <span>Airtable column</span>
            </div>
            {SHOWFLOW_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
                <Label>{f.label}{f.optional ? " (optional)" : ""}</Label>
                <Select value={(fieldMap[f.key] as string | null) ?? NONE} onValueChange={(v) => setField(f.key, v === NONE ? null : v)} disabled={readOnly}>
                  <SelectTrigger aria-label={f.label}><SelectValue placeholder="Not mapped" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not mapped</SelectItem>
                    {selectedTable.fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {/* Cancellation mapping (status → cancelled + reason) */}
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
              <Label>Status field (optional)</Label>
              <Select value={fieldMap.status_field ?? NONE} onValueChange={(v) => setField('status_field', v === NONE ? null : v)} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not mapped</SelectItem>
                  {selectedTable.fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {fieldMap.status_field && (
              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
                <Label>"Cancelled" value</Label>
                <Select value={fieldMap.cancelled_value ?? NONE} onValueChange={(v) => setField('cancelled_value', v === NONE ? null : v)} disabled={readOnly}>
                  <SelectTrigger><SelectValue placeholder="Pick the cancelled option" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {optionNames(fieldMap.status_field).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
              <Label>Cancellation reason (optional)</Label>
              <Select value={fieldMap.cancellation_reason_field ?? NONE} onValueChange={(v) => setField('cancellation_reason_field', v === NONE ? null : v)} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not mapped</SelectItem>
                  {selectedTable.fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Custom fields ──────────────────────────────────────────────────── */}
      {selectedTable && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Custom fields</CardTitle>
            <CardDescription>
              Capture extra Airtable fields as typed columns on show dates: shown, filtered, and sorted in the producer Shows &amp; Bookings table (toggle them on via the column editor). These are display metadata only; they never affect bookings, slots, or offers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {customDefs.length === 0 && (
              <p className="text-sm text-muted-foreground">No custom fields yet.</p>
            )}
            {customDefs.map((d) => (
              <div key={d.id} className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3 items-center border-t border-border pt-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.label}</div>
                  <div className="text-xs text-muted-foreground truncate">from “{d.source_field}”</div>
                </div>
                <Select value={d.type} onValueChange={(v) => setCustomType.mutate({ def: d, type: v as CustomFieldType })} disabled={readOnly}>
                  <SelectTrigger className="h-8" aria-label={`type for ${d.label}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <IconTooltip label={`Remove ${d.label}`}>
                  <Button size="sm" variant="ghost" onClick={() => removeCustom.mutate(d.id)} disabled={readOnly || removeCustom.isPending} aria-label={`Remove ${d.label}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </IconTooltip>
              </div>
            ))}
            <Separator />
            <div className="space-y-2">
              <Label>Add a custom field from an unmapped Airtable field</Label>
              <Select
                value=""
                onValueChange={(name) => {
                  const af = selectedTable.fields.find((f) => f.name === name);
                  if (!af) return;
                  const key = slugifyKey(af.name);
                  if (customDefs.some((d) => d.key === key)) {
                    toast.error(`A custom field with key "${key}" already exists. Rename or remove it first.`);
                    return;
                  }
                  addCustom.mutate({ name: af.name, type: af.type, options: af.options });
                }}
                disabled={readOnly || addCustom.isPending || unboundFields.length === 0}
              >
                <SelectTrigger><SelectValue placeholder={unboundFields.length ? "Pick an Airtable field…" : "No unmapped fields left"} /></SelectTrigger>
                <SelectContent>
                  {unboundFields.map((f) => <SelectItem key={f.id} value={f.name}>{f.name} <span className="text-muted-foreground">({f.type})</span></SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Type is auto-detected from Airtable; adjust above if needed.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Catalog links ──────────────────────────────────────────────────── */}
      {selectedTable && (fieldMap.sub_program || fieldMap.city) && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">4 · Catalog links</CardTitle>
            <CardDescription>
              Link each Airtable option to a ShowFlow show/city, or create one inline. The sync resolves records against these links; anything unlinked is held, never dropped. New shows start with no slot config. Set counts in the Shows tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {fieldMap.sub_program && (
              fieldMap.program && programPairsQ.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : fieldMap.program && programPairsQ.isError ? (
                <Alert variant="destructive"><AlertDescription>Couldn't load program options from Airtable. Try refreshing the schema.</AlertDescription></Alert>
              ) : fieldMap.program && programPairsQ.data?.schemaAccessible === false ? (
                <Alert variant="destructive"><AlertDescription>Your Airtable key can't read records (it needs the data.records:read scope), so program options can't be listed.</AlertDescription></Alert>
              ) : (
                <CatalogSection
                  title="Programs"
                  sourceLabel={programSource}
                  rows={programRows}
                  unlinkedCount={programUnlinked}
                  importAll={() => importPrograms.mutate()}
                  importDisabled={importPrograms.isPending || showsQ.isLoading || programUnlinked === 0}
                  existing={programExisting}
                  onCreate={(row) => { if (row.createPair) createOneProgram.mutate(row.createPair); }}
                  onLink={(row, id) => linkShow.mutate({ showId: id, key: row.key })}
                  onUnlink={(id) => unlinkShow.mutate(id)}
                  busy={createOneProgram.isPending || showsQ.isLoading || linkShow.isPending || unlinkShow.isPending}
                  entityNoun="show"
                  emptyHint="No program options found in the mapped table."
                  readOnly={readOnly}
                />
              )
            )}
            {fieldMap.city && (
              <CatalogSection
                title="Cities"
                sourceLabel={citySource}
                rows={cityRows}
                unlinkedCount={cityUnlinked}
                importAll={() => importCities.mutate()}
                importDisabled={importCities.isPending || citiesQ.isLoading || cityUnlinked === 0}
                existing={cityExisting}
                onCreate={(row) => createOneCity.mutate(row.display)}
                onLink={(row, id) => linkCity.mutate({ cityId: id, key: row.key })}
                onUnlink={(id) => unlinkCity.mutate(id)}
                busy={createOneCity.isPending || citiesQ.isLoading || linkCity.isPending || unlinkCity.isPending}
                entityNoun="city"
                emptyHint="No options on the mapped City field."
                readOnly={readOnly}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Duplicate cities ───────────────────────────────────────────────── */}
      {dupeGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Duplicate cities</CardTitle>
            <CardDescription>Cities whose names match (ignoring case/spacing). Pick the one to keep and merge: its bookings, eligibility, and producer routing are preserved; the others are removed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {dupeGroups.map((g) => {
              const survivor = survivorFor(g);
              const losers = g.cities.filter((c) => c.id !== survivor).map((c) => c.id);
              return (
                <div key={g.norm} className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Keep </span>
                      <Select value={survivor} onValueChange={(v) => setSurvivorByNorm((m) => ({ ...m, [g.norm]: v }))} disabled={readOnly}>
                        <SelectTrigger className="inline-flex h-8 w-[220px]" aria-label={`survivor for ${g.norm}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {g.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.airtable_city_key ? " (linked)" : ""}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={readOnly || mergeMut.isPending}>Merge</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Merge {g.cities.length} cities into one?</AlertDialogTitle>
                          <AlertDialogDescription>{losers.length} duplicate row(s) will be removed and their references repointed to the kept city. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => mergeMut.mutate({ survivor, losers })}>Merge cities</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <ul className="text-xs text-muted-foreground">
                    {g.cities.map((c) => <li key={c.id}>{c.name}{c.id === survivor ? " · kept" : " · removed"}</li>)}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Last sync report ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Last sync report</CardTitle>
          {/* Cause-neutral, mirroring the airtable-sync-held email whose CTA lands here:
              held has more than one cause (a blank date cell as well as an unlinked
              program), so this must not assert the mapping-only one. The record rows
              below carry each held record's actual reason. */}
          <CardDescription>The most recent Airtable poll. Held records could not be brought into ShowFlow: the rows below say which ones and why. Fix the cause and they import on the next run. Errored records hit a write error and are worth investigating.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!syncLogQ.data ? (
            <p className="text-sm text-muted-foreground">No sync has run yet for this organization.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <div><span className="text-muted-foreground">Status </span><Badge variant={syncLogQ.data.status === "success" ? "secondary" : "outline"}>{syncLogQ.data.status}</Badge></div>
                <div><span className="text-muted-foreground">Imported </span><strong>{syncLogQ.data.imported_count ?? 0}</strong></div>
                <div><span className="text-muted-foreground">New </span><strong>{syncLogQ.data.new_count ?? 0}</strong></div>
                <div><span className="text-muted-foreground">Updated </span><strong>{syncLogQ.data.updated_count ?? 0}</strong></div>
                <div><span className="text-muted-foreground">Held </span><strong>{syncLogQ.data.held_count ?? 0}</strong></div>
              </div>
              {syncLogQ.data.error_details && (
                <p className="text-sm text-muted-foreground">{syncLogQ.data.error_details}</p>
              )}
              {heldRecords.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display font-semibold text-sm">Held records</h4>
                  {heldRecords.map(renderRecordRow)}
                </div>
              )}
              {erroredRecords.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display font-semibold text-sm">Errored records</h4>
                  {erroredRecords.map(renderRecordRow)}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
