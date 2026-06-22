import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, CheckCircle2, KeyRound, Lock } from "lucide-react";
import { fetchCustomFieldDefs, upsertCustomFieldDef, deleteCustomFieldDef } from "@/data/customFields";
import { airtableTypeToCustomType, slugifyKey, type CustomFieldType } from "@/lib/customFields";
import { fetchAirtableBases, fetchAirtableTables, type AirtableTable } from "@/data/airtableSchema";
import { SHOWFLOW_FIELDS, buildProgramKey, buildCityKey, planCityReconciliation, groupDuplicateCities, type AirtableFieldMap } from "@/data/airtableMapping";
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions } from "@/data/settings";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities } from "@/data/cities";
import { fetchLatestSyncLog, fetchUnresolvedRecords, type UnresolvedRecord } from "@/data/airtableSync";
import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "@/data/airtableKey";
import { formatDateDMY } from "@/lib/dates";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Props {
  orgId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (key: string, fallback?: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (key: string, value: any) => void;
}

/** shadcn Select cannot use "" as an item value, so "not mapped" needs a sentinel. */
const NONE = "__none__";

export function AirtableSyncTab({ orgId, get, set }: Props) {
  const qc = useQueryClient();
  const [airtableKey, setAirtableKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [schemaState, setSchemaState] = useState<"idle" | "accessible" | "fallback">("idle");
  const [bases, setBases] = useState<{ id: string; name: string }[]>([]);
  const [tables, setTables] = useState<AirtableTable[]>([]);
  const [survivorByNorm, setSurvivorByNorm] = useState<Record<string, string>>({});

  const fieldMap = (get("airtable_field_map", {}) ?? {}) as AirtableFieldMap;
  const setField = (key: keyof AirtableFieldMap, value: string | null) =>
    set("airtable_field_map", { ...fieldMap, [key]: value });

  const selectedTable = tables.find((t) => t.name === get("airtable_table_name", ""));

  // ── API-key presence (status only; the key value is never read back) ─────────
  const keyStatusQ = useQuery({
    queryKey: ["airtable", "key-status", orgId],
    enabled: !!orgId,
    queryFn: () => fetchAirtableKeyStatus(supabase, orgId!),
  });
  const keyPresent = !!keyStatusQ.data?.present;

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
      setSchemaState("idle"); setBases([]); setTables([]);
      qc.invalidateQueries({ queryKey: ["airtable", "key-status", orgId] });
      toast.success("Airtable API key deleted");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to delete Airtable key"),
  });

  const loadBases = useMutation({
    mutationFn: () => fetchAirtableBases(supabase, orgId!),
    onSuccess: (res) => {
      if (res.schemaAccessible) { setSchemaState("accessible"); setBases(res.bases ?? []); }
      else { setSchemaState("fallback"); toast.info("Airtable key can't read schema — enter base/table/field names manually."); }
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Could not load Airtable bases"),
  });
  const loadTables = useMutation({
    mutationFn: (baseId: string) => fetchAirtableTables(supabase, orgId!, baseId),
    onSuccess: (res) => setTables(res.schemaAccessible ? res.tables ?? [] : []),
    onError: (e: unknown) => toast.error((e as Error).message ?? "Could not load tables"),
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
  const baseId = get("airtable_base_id", "") as string;
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

  const programOptions = optionNames(fieldMap.sub_program); // sub-program-only linking (current scope)
  const cityOptions = optionNames(fieldMap.city);

  const showByKey = new Map((showsQ.data ?? []).filter((s) => s.airtable_program_key).map((s) => [s.airtable_program_key!, s]));
  const cityByKey = new Map((citiesQ.data ?? []).filter((c) => c.airtable_city_key).map((c) => [c.airtable_city_key!, c]));

  // ── Import / unlink mutations ───────────────────────────────────────────────
  const importPrograms = useMutation({
    mutationFn: async () => {
      const rows = programOptions
        .map((name) => ({ name, key: buildProgramKey(null, name) }))
        .filter((r) => r.key && !showByKey.has(r.key))
        .map((r) => ({ program: null, sub_program: r.name, key: r.key! }));
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
  const unlinkedCities = (citiesQ.data ?? []).filter((c) => !c.airtable_city_key);

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
          <CardTitle className="font-display">Airtable Sync</CardTitle>
          <CardDescription>
            Pull show schedules from Airtable on a schedule. Follow the steps below: save your API key, load the base &amp; table, then map fields and link your catalog. Sync runs every few minutes once enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Enable Airtable sync</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Turn polling on or off globally.</p>
            </div>
            <Switch checked={!!get("airtable_sync_enabled", false)} onCheckedChange={(v) => set("airtable_sync_enabled", v)} />
          </div>

          {!!get("airtable_sync_enabled", false) && !keyStatusQ.isLoading && !keyPresent && (
            <Alert variant="destructive">
              <AlertDescription>Sync is on but no API key is saved — the poll can't run until you add a key below.</AlertDescription>
            </Alert>
          )}

          <Separator />

          {/* Step 1 — API key (write-only: stored in Vault, never read back into the UI) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">1</span>
              <Label className="font-medium">API key</Label>
              {keyStatusQ.isLoading ? null : keyPresent ? (
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Saved</Badge>
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
                  <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>Replace</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={deleteKey.isPending}>
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
                  <Input id="airtable-key" type="password" autoComplete="off" placeholder={keyPresent ? "Enter a new key…" : "key… (write-only)"} value={airtableKey} onChange={(e) => setAirtableKey(e.target.value)} />
                  <Button onClick={() => saveKey.mutate()} disabled={saveKey.isPending}>{keyPresent ? "Update" : "Save key"}</Button>
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
            <Button variant="outline" onClick={() => loadBases.mutate()} disabled={loadBases.isPending || !orgId || !keyPresent}>
              {loadBases.isPending ? "Loading…" : "Load from Airtable"}
            </Button>
            {!keyPresent && <p className="text-xs text-muted-foreground">Save an API key first to load bases &amp; tables.</p>}
            {schemaState === "accessible" ? (
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Base</Label>
                  <Select value={get("airtable_base_id", "")} onValueChange={(v) => { set("airtable_base_id", v); setTables([]); set("airtable_table_name", ""); loadTables.mutate(v); }}>
                    <SelectTrigger><SelectValue placeholder="Select a base" /></SelectTrigger>
                    <SelectContent>{bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Table</Label>
                  <Select value={get("airtable_table_name", "")} onValueChange={(v) => set("airtable_table_name", v)} disabled={!tables.length}>
                    <SelectTrigger><SelectValue placeholder="Select a table" /></SelectTrigger>
                    <SelectContent>{tables.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ) : schemaState === "fallback" ? (
              <>
                <Alert>
                  <AlertDescription>
                    Your Airtable key lacks the <code>schema.bases:read</code> scope. Grant it to pick base/table/fields from dropdowns; until then, type the names below.
                  </AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <Label>Airtable base ID</Label>
                    <Input placeholder="app1234567890" value={get("airtable_base_id", "")} onChange={(e) => set("airtable_base_id", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Airtable table name</Label>
                    <Input placeholder="Shows" value={get("airtable_table_name", "")} onChange={(e) => set("airtable_table_name", e.target.value)} />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ── Field mapping ──────────────────────────────────────────────────── */}
      {selectedTable && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">3 · Field mapping</CardTitle>
            <CardDescription>
              Map each ShowFlow field to a column in <strong>{selectedTable.name}</strong>. Catalog links are keyed on the <strong>Sub-program</strong> option — map the Sub-program field to enable linking below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {SHOWFLOW_FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
                <Label>{f.label}{f.optional ? " (optional)" : ""}</Label>
                <Select value={(fieldMap[f.key] as string | null) ?? NONE} onValueChange={(v) => setField(f.key, v === NONE ? null : v)}>
                  <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
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
              <Select value={fieldMap.status_field ?? NONE} onValueChange={(v) => setField('status_field', v === NONE ? null : v)}>
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
                <Select value={fieldMap.cancelled_value ?? NONE} onValueChange={(v) => setField('cancelled_value', v === NONE ? null : v)}>
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
              <Select value={fieldMap.cancellation_reason_field ?? NONE} onValueChange={(v) => setField('cancellation_reason_field', v === NONE ? null : v)}>
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
              Capture extra Airtable fields as typed columns on show dates — shown, filtered, and sorted in the producer Shows &amp; Bookings table (toggle them on via the column editor). These are display metadata only; they never affect bookings, slots, or offers.
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
                <Select value={d.type} onValueChange={(v) => setCustomType.mutate({ def: d, type: v as CustomFieldType })}>
                  <SelectTrigger className="h-8" aria-label={`type for ${d.label}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => removeCustom.mutate(d.id)} disabled={removeCustom.isPending} aria-label={`remove ${d.label}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
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
                    toast.error(`A custom field with key "${key}" already exists — rename or remove it first.`);
                    return;
                  }
                  addCustom.mutate({ name: af.name, type: af.type, options: af.options });
                }}
                disabled={addCustom.isPending || unboundFields.length === 0}
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
              "Import all" creates a ShowFlow show/city for each unlinked Airtable option (new shows start with no slot config — set counts in the Shows tab). The sync resolves records against these links; anything unlinked is held, never dropped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {fieldMap.sub_program && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold">Programs ({fieldMap.sub_program})</h4>
                  <Button variant="outline" size="sm" onClick={() => importPrograms.mutate()} disabled={importPrograms.isPending || !programOptions.length}>Import all</Button>
                </div>
                {programOptions.length ? programOptions.map((name) => {
                  const key = buildProgramKey(null, name);
                  const show = key ? showByKey.get(key) : undefined;
                  return (
                    <div key={name} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="text-sm font-medium">{name}</span>
                      {show
                        ? <div className="flex items-center gap-2"><Badge variant="secondary">linked</Badge><Button size="sm" variant="ghost" onClick={() => unlinkShow.mutate(show.id)} disabled={unlinkShow.isPending}>Unlink</Button></div>
                        : <Badge variant="outline">unlinked</Badge>}
                    </div>
                  );
                }) : <p className="text-sm text-muted-foreground">No options on the mapped Sub-program field.</p>}
              </div>
            )}
            {fieldMap.city && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold">Cities ({fieldMap.city})</h4>
                  <Button variant="outline" size="sm" onClick={() => importCities.mutate()} disabled={importCities.isPending || !cityOptions.length}>Import all</Button>
                </div>
                {cityOptions.length ? cityOptions.map((name) => {
                  const key = buildCityKey(name);
                  const city = key ? cityByKey.get(key) : undefined;
                  return (
                    <div key={name} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="text-sm font-medium">{name}</span>
                      {city
                        ? <div className="flex items-center gap-2"><Badge variant="secondary">linked</Badge><Button size="sm" variant="ghost" onClick={() => unlinkCity.mutate(city.id)} disabled={unlinkCity.isPending}>Unlink</Button></div>
                        : (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">unlinked</Badge>
                            {unlinkedCities.length > 0 && key && (
                              <Select onValueChange={(cityId) => linkCity.mutate({ cityId, key: key! })} disabled={linkCity.isPending}>
                                <SelectTrigger className="h-8 w-[200px]" aria-label={`link ${name} to an existing city`}>
                                  <SelectValue placeholder="Link to existing…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {unlinkedCities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
                    </div>
                  );
                }) : <p className="text-sm text-muted-foreground">No options on the mapped City field.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Duplicate cities ───────────────────────────────────────────────── */}
      {dupeGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Duplicate cities</CardTitle>
            <CardDescription>Cities whose names match (ignoring case/spacing). Pick the one to keep and merge — its bookings, eligibility, and producer routing are preserved; the others are removed.</CardDescription>
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
                      <Select value={survivor} onValueChange={(v) => setSurvivorByNorm((m) => ({ ...m, [g.norm]: v }))}>
                        <SelectTrigger className="inline-flex h-8 w-[220px]" aria-label={`survivor for ${g.norm}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {g.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.airtable_city_key ? " (linked)" : ""}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={mergeMut.isPending}>Merge</Button>
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
                    {g.cities.map((c) => <li key={c.id}>{c.name}{c.id === survivor ? " — kept" : " — removed"}</li>)}
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
          <CardDescription>The most recent Airtable poll. Held records were not matched to a linked program — link the option above and they import on the next run. Errored records hit a write error and are worth investigating.</CardDescription>
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
