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
import { fetchAirtableBases, fetchAirtableTables, type AirtableTable } from "@/data/airtableSchema";
import { SHOWFLOW_FIELDS, buildProgramKey, buildCityKey, planCityReconciliation, type AirtableFieldMap } from "@/data/airtableMapping";
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions } from "@/data/settings";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions } from "@/data/cities";
import { fetchLatestSyncLog, fetchUnresolvedRecords, type UnresolvedRecord } from "@/data/airtableSync";

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
  const [schemaState, setSchemaState] = useState<"idle" | "accessible" | "fallback">("idle");
  const [bases, setBases] = useState<{ id: string; name: string }[]>([]);
  const [tables, setTables] = useState<AirtableTable[]>([]);

  const fieldMap = (get("airtable_field_map", {}) ?? {}) as AirtableFieldMap;
  const setField = (key: keyof AirtableFieldMap, value: string | null) =>
    set("airtable_field_map", { ...fieldMap, [key]: value });

  const selectedTable = tables.find((t) => t.name === get("airtable_table_name", ""));

  // ── API key (Vault) + schema loading ────────────────────────────────────────
  const saveKey = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      if (!airtableKey.trim()) throw new Error("Enter an API key");
      const { error } = await supabase.rpc("set_org_airtable_key", { _org: orgId, _key: airtableKey.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setAirtableKey(""); toast.success("Airtable API key saved"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to save Airtable key"),
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

  return (
    <div className="space-y-6">
      {/* ── Connection ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Airtable Sync</CardTitle>
          <CardDescription>
            Pull show schedules from Airtable on a regular interval. The sync runs on a pg_cron schedule — enable this toggle to allow the cron job to process records. Save the key, then load the base/table from Airtable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Enable Airtable sync</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Turn polling on or off globally.</p>
            </div>
            <Switch checked={!!get("airtable_sync_enabled", false)} onCheckedChange={(v) => set("airtable_sync_enabled", v)} />
          </div>
          <Separator />
          {/* Write-only: the key is stored in Vault and never read back into the UI. */}
          <div className="space-y-2">
            <Label htmlFor="airtable-key">Airtable API key</Label>
            <div className="flex gap-2">
              <Input id="airtable-key" type="password" autoComplete="off" placeholder="key… (write-only)" value={airtableKey} onChange={(e) => setAirtableKey(e.target.value)} />
              <Button onClick={() => saveKey.mutate()} disabled={saveKey.isPending}>Save key</Button>
            </div>
            <p className="text-sm text-muted-foreground">Stored encrypted; never displayed. Required for Airtable sync.</p>
          </div>
          <Separator />
          <div className="space-y-4">
            <Button variant="outline" onClick={() => loadBases.mutate()} disabled={loadBases.isPending || !orgId}>
              {loadBases.isPending ? "Loading…" : "Load from Airtable"}
            </Button>
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
            ) : (
              <>
                {schemaState === "fallback" && (
                  <Alert>
                    <AlertDescription>
                      Your Airtable key lacks the <code>schema.bases:read</code> scope. Grant it to pick base/table/fields from dropdowns; until then, type the names below.
                    </AlertDescription>
                  </Alert>
                )}
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
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Field mapping ──────────────────────────────────────────────────── */}
      {selectedTable && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Field mapping</CardTitle>
            <CardDescription>
              Map each Showflow field to a column in <strong>{selectedTable.name}</strong>. Catalog links are keyed on the <strong>Sub-program</strong> option — map the Sub-program field to enable linking below.
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
          </CardContent>
        </Card>
      )}

      {/* ── Catalog links ──────────────────────────────────────────────────── */}
      {selectedTable && (fieldMap.sub_program || fieldMap.city) && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Catalog links</CardTitle>
            <CardDescription>
              "Import all" creates a Showflow show/city for each unlinked Airtable option (new shows start with no slot config — set counts in the Shows tab). The sync resolves records against these links; anything unlinked is held, never dropped.
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
