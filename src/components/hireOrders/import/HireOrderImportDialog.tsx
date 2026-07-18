import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { fetchPublicSheetCsv } from "@/data/remoteSheet";
import { parseSheetRaw, MAX_IMPORT_ROWS, type RawSheet } from "@/lib/artistImport/parseSheet";
import { applyRange, type SheetRange } from "@/lib/hireOrderImport/rangeSelection";
import { guessOrderMapping, type OrderColumnMapping } from "@/lib/hireOrderImport/guessOrderMapping";
import {
  buildOrderRows,
  type ImportCatalog,
  type ImportRowInput,
  type ResolvedImportRow,
} from "@/lib/hireOrderImport/buildOrderRows";
import { resolveFields } from "@/lib/hireOrders/resolveFields";
import type { OrderFieldKey } from "@/lib/hireOrders/types";
import { useArtistsLite, useShowDatesLite, useBulkImportHireOrders, useCreateArtistLite } from "@/hooks/useHireOrders";
import type { BulkImportHireOrdersRow } from "@/data/hireOrders";
import { ROUTES } from "@/config/app.config";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RangeStep } from "./RangeStep";
import { MapStep } from "./MapStep";
import { ResolveStep, type RowLink } from "./ResolveStep";
import { ReviewStep, type ManualEdit, type ReviewRow } from "./ReviewStep";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
}

type Step = "source" | "range" | "map" | "resolve" | "review" | "done";
type SourceKind = "xlsx" | "csv" | "gsheet";

const STEP_ORDER: Step[] = ["source", "range", "map", "resolve", "review"];
const STEP_LABELS: Record<Step, string> = {
  source: "Source", range: "Range", map: "Map columns", resolve: "Resolve", review: "Review", done: "Done",
};

interface OrderDefaultsLite { default_fee: number | null; currency: string }
const DEFAULTS_FALLBACK: OrderDefaultsLite = { default_fee: null, currency: "EUR" };

/** Fee is unconditionally checked by buildOrderRows regardless of whether a fee
 *  column was mapped, so routing a per-row manual fee edit through a synthetic
 *  column key is always safe: unedited rows never gain the key, so their
 *  computed status is byte-identical to not having this key at all. */
const FEE_OVERRIDE_KEY = "__manualFeeOverride__";

interface ImportResult { created: number; skippedExisting: number; error: number }

/**
 * Spreadsheet import wizard: Source -> Range -> Map -> Resolve -> Review -> Done.
 * Holds only raw state (`rawSheets`, `range`, `mapping`, `manualEdits`, `links`,
 * `selection`) and recomputes every derived value (headers, resolved rows, tile
 * counts) via useMemo from the Task-3 pure functions (`applyRange`,
 * `guessOrderMapping`, `buildOrderRows`) plus `resolveFields` at submit time.
 * Creates DRAFT hire orders only, via `bulk_import_hire_orders` — never issues.
 */
export function HireOrderImportDialog({ open, onOpenChange, orgId }: Props) {
  const navigate = useNavigate();
  const { data: artists = [] } = useArtistsLite(orgId);
  const { data: showDates = [] } = useShowDatesLite(orgId);
  const bulkImport = useBulkImportHireOrders();
  const createArtist = useCreateArtistLite();

  const defaultsQuery = useQuery({
    queryKey: ["app-settings", "hire_order_defaults", orgId],
    queryFn: () => resolveOrgSetting<OrderDefaultsLite>(supabase, orgId, "hire_order_defaults", DEFAULTS_FALLBACK),
    enabled: !!orgId,
  });

  const [step, setStep] = useState<Step>("source");
  const [rawSheets, setRawSheets] = useState<RawSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [source, setSource] = useState<SourceKind | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [range, setRange] = useState<SheetRange>({ headerRow: 1, mode: "all" });
  const [mapping, setMapping] = useState<OrderColumnMapping>({});
  const [manualEdits, setManualEdits] = useState<Record<number, ManualEdit>>({});
  const [links, setLinks] = useState<Record<number, RowLink>>({});
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [linkUrl, setLinkUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [creatingRowIndex, setCreatingRowIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function resetAll() {
    setStep("source"); setRawSheets([]); setSheetIndex(0); setSource(null); setFileName(null);
    setRange({ headerRow: 1, mode: "all" }); setMapping({}); setManualEdits({}); setLinks({});
    setSelection(new Set()); setLinkUrl(""); setFetching(false); setCreatingRowIndex(null);
    setSubmitting(false); setResult(null);
    lastMappedHeadersKeyRef.current = null;
    lastReviewRowSetKeyRef.current = null;
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetAll();
    onOpenChange(next);
  }

  // ── Source ────────────────────────────────────────────────────────────────
  function ingestSheets(sheets: RawSheet[], kind: SourceKind, name: string | null) {
    if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) {
      toast.error("No rows found in that file.");
      return;
    }
    setRawSheets(sheets);
    setSheetIndex(0);
    setSource(kind);
    setFileName(name);
    setRange({ headerRow: 1, mode: "all" });
    setMapping({});
    setManualEdits({});
    setLinks({});
    setSelection(new Set());
    lastMappedHeadersKeyRef.current = null;
    lastReviewRowSetKeyRef.current = null;
    setStep("range");
  }

  async function onFile(file: File) {
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const parsed = isXlsx
        ? await parseSheetRaw(await file.arrayBuffer(), "xlsx")
        : await parseSheetRaw(await file.text(), "csv");
      ingestSheets(parsed.sheets, isXlsx ? "xlsx" : "csv", file.name);
    } catch (e) {
      toast.error((e as Error).message || "Could not read the file");
    }
  }

  async function onFetchLink() {
    if (!orgId || !linkUrl.trim()) return;
    setFetching(true);
    try {
      const csv = await fetchPublicSheetCsv(supabase, linkUrl.trim(), orgId);
      const parsed = await parseSheetRaw(csv, "csv");
      ingestSheets(parsed.sheets, "gsheet", null);
    } catch (e) {
      toast.error((e as Error).message || "Could not fetch the sheet");
    } finally {
      setFetching(false);
    }
  }

  // ── Range / Map derivation (all via the Task-3 pure functions) ─────────────
  const currentRows = useMemo(() => rawSheets[sheetIndex]?.rows ?? [], [rawSheets, sheetIndex]);
  const { headers, dataRows } = useMemo(() => applyRange(currentRows, range), [currentRows, range]);

  // Tracks which headers the mapping was last (re)seeded from, so a Map
  // revisit with unchanged headers preserves the user's manual overrides
  // instead of silently re-running guessOrderMapping over them.
  const lastMappedHeadersKeyRef = useRef<string | null>(null);

  function goToMap() {
    const headersKey = JSON.stringify(headers);
    const headersChanged = lastMappedHeadersKeyRef.current !== headersKey;
    const mappingEmpty = Object.keys(mapping).length === 0;
    if (headersChanged || mappingEmpty) {
      setMapping(guessOrderMapping(headers));
    }
    lastMappedHeadersKeyRef.current = headersKey;
    setStep("map");
  }

  const catalog: ImportCatalog = useMemo(
    () => ({
      artists: artists.map((a) => ({ id: a.id, name: a.name, email: a.email })),
      dates: showDates.map((d) => ({ id: d.id, date: d.date, venue: d.venue, city: d.city })),
    }),
    [artists, showDates],
  );

  // A manual fee edit is always safe to route through a synthetic mapping key
  // (see FEE_OVERRIDE_KEY docs above). A manual date edit is only routed back
  // into buildOrderRows when a date column IS mapped — buildOrderRows only
  // flags missing_date conditionally on mapping.date being set, and forcing that
  // globally would flag "missing_date" on every row of an import that never
  // mapped a date column at all, which is a real supported case (standalone
  // orders with no linked date).
  const effectiveMapping: OrderColumnMapping = useMemo(
    () => ({ ...mapping, fee: mapping.fee ?? FEE_OVERRIDE_KEY }),
    [mapping],
  );

  const rowInputs: ImportRowInput[] = useMemo(
    () =>
      dataRows.map(({ rowIndex, cells }) => {
        const record: Record<string, string> = {};
        headers.forEach((h, i) => { record[h] = cells[i] ?? ""; });
        const edit = manualEdits[rowIndex];
        if (edit?.fee !== undefined) record[effectiveMapping.fee as string] = edit.fee;
        if (edit?.date !== undefined && mapping.date) record[mapping.date] = edit.date;
        return { rowIndex, record };
      }),
    [dataRows, headers, manualEdits, mapping.date, effectiveMapping.fee],
  );

  const resolvedRows: ResolvedImportRow[] = useMemo(
    () => buildOrderRows(rowInputs, effectiveMapping, catalog),
    [rowInputs, effectiveMapping, catalog],
  );

  const unresolvedArtistRows = useMemo(
    () => resolvedRows.filter((r) => r.status !== "skipped" && r.issues.includes("unknown_artist")),
    [resolvedRows],
  );

  // Effective status/issues once the Resolve step's local links are folded in —
  // a linked row's unknown_artist issue is resolved for display purposes even
  // though buildOrderRows itself has no notion of a user-picked link.
  const displayRows: ReviewRow[] = useMemo(
    () =>
      resolvedRows.map((r) => {
        if (r.status === "skipped") return { rowIndex: r.rowIndex, sheet: r.sheet, status: "skipped", issues: r.issues };
        const hasLink = !!links[r.rowIndex];
        const issues = hasLink ? r.issues.filter((i) => i !== "unknown_artist") : r.issues;
        const status: ReviewRow["status"] = issues.length > 0 ? "attention" : "ready";
        return { rowIndex: r.rowIndex, sheet: r.sheet, status, issues };
      }),
    [resolvedRows, links],
  );

  // Tracks the row-index set Review was last seeded from, so a revisit with
  // the same underlying rows preserves whatever the user selected (including a
  // manual over-selection of an "attention" row) instead of silently resetting
  // it. Only reseeds on the first-ever visit or when the resolved row set
  // itself changed (e.g. the user went back and changed the range/mapping).
  const lastReviewRowSetKeyRef = useRef<string | null>(null);

  function goToReview() {
    const rowSetKey = JSON.stringify(displayRows.map((r) => r.rowIndex));
    if (lastReviewRowSetKeyRef.current !== rowSetKey) {
      const ready = displayRows.filter((r) => r.status === "ready").map((r) => r.rowIndex);
      setSelection(new Set(ready));
      lastReviewRowSetKeyRef.current = rowSetKey;
    }
    setStep("review");
  }

  // ── Resolve ──────────────────────────────────────────────────────────────
  function linkArtist(rowIndex: number, artistId: string, artistName: string) {
    setLinks((prev) => ({ ...prev, [rowIndex]: { id: artistId, name: artistName } }));
  }

  async function createArtistForRow(rowIndex: number) {
    if (!orgId) return;
    const row = resolvedRows.find((r) => r.rowIndex === rowIndex);
    const name = (row?.sheet.artist_name as string | undefined)?.trim();
    if (!name) {
      toast.error("This row has no artist name to create");
      return;
    }
    const email = (row?.sheet.recipient_email as string | undefined)?.trim() || null;
    setCreatingRowIndex(rowIndex);
    try {
      const created = await createArtist.mutateAsync({ orgId, name, email });
      linkArtist(rowIndex, created.id, created.name);
    } catch {
      // useCreateArtistLite already toasts the failure.
    } finally {
      setCreatingRowIndex(null);
    }
  }

  // ── Review ───────────────────────────────────────────────────────────────
  function toggleRow(rowIndex: number, checked: boolean) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelection(new Set());
      return;
    }
    setSelection(new Set(displayRows.filter((r) => r.status !== "skipped").map((r) => r.rowIndex)));
  }
  function editFee(rowIndex: number, value: string) {
    setManualEdits((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], fee: value } }));
  }
  function editDate(rowIndex: number, value: string) {
    setManualEdits((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], date: value } }));
  }

  async function handleSubmit() {
    if (!orgId) return;
    const chosen = resolvedRows.filter((r) => selection.has(r.rowIndex));
    if (chosen.length === 0) return;
    setSubmitting(true);
    try {
      const rpcRows: BulkImportHireOrdersRow[] = chosen.map((r) => {
        const data = resolveFields({
          sheet: r.sheet,
          manual: (manualEdits[r.rowIndex] ?? {}) as Partial<Record<OrderFieldKey, unknown>>,
          defaults: {
            currency: defaultsQuery.data?.currency ?? DEFAULTS_FALLBACK.currency,
            ...(defaultsQuery.data?.default_fee != null ? { fee: defaultsQuery.data.default_fee } : {}),
          },
        });
        const feeRaw = data.fee?.value;
        const feeNumeric = feeRaw != null && feeRaw !== "" ? Number(feeRaw) : NaN;
        // fee_currency follows the RESOLVED currency (mapped/manual sheet value
        // wins over the org default), mirroring draftManual in
        // generate-hire-orders/index.ts and HireOrderEditPage.tsx:211 — a row
        // never silently loses a currency the sheet or a manual edit supplied.
        const currencyValue = data.currency?.value;
        const currency =
          typeof currencyValue === "string" && currencyValue
            ? currencyValue
            : defaultsQuery.data?.currency ?? DEFAULTS_FALLBACK.currency;
        return {
          row_index: r.rowIndex,
          artist_id: links[r.rowIndex]?.id ?? r.matchedArtistId ?? null,
          show_date_id: r.matchedShowDateId ?? null,
          data,
          ...(Number.isFinite(feeNumeric) ? { fee_amount: feeNumeric } : {}),
          fee_currency: currency,
          terms_variant: "standard",
        };
      });

      const results = await bulkImport.mutateAsync({
        orgId,
        import: {
          source: source ?? "csv",
          file_name: fileName,
          mapping: mapping as Record<string, unknown>,
          row_count: rpcRows.length,
        },
        rows: rpcRows,
      });

      setResult({
        created: results.filter((x) => x.status === "created").length,
        skippedExisting: results.filter((x) => x.status === "skipped_existing").length,
        error: results.filter((x) => x.status === "error").length,
      });
      setStep("done");
    } catch {
      // useBulkImportHireOrders already toasts the failure.
    } finally {
      setSubmitting(false);
    }
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  }

  const activeIdx = STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Import hire orders from a spreadsheet</DialogTitle>
          <DialogDescription>
            Upload a CSV/XLSX or paste a public Google Sheets link, pick the header row, map the columns, then
            review and create draft hire orders.
          </DialogDescription>
        </DialogHeader>

        {step !== "done" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {STEP_ORDER.map((s, i) => {
              const state = i < activeIdx ? "done" : i === activeIdx ? "current" : "todo";
              return (
                <div key={s} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full",
                      state === "todo" ? "border border-border text-muted-foreground" : "bg-accent-500 text-primary-foreground",
                    )}
                  >
                    {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className={state === "current" ? "font-medium text-foreground" : "text-muted-foreground"}>
                    {STEP_LABELS[s]}
                  </span>
                  {i < STEP_ORDER.length - 1 && <span className="h-px w-6 bg-border" />}
                </div>
              );
            })}
          </div>
        )}

        {step === "source" && (
          <div className="space-y-4">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center hover:bg-muted/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm">Drop a .csv or .xlsx here, or click to browse</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                aria-label="Upload spreadsheet"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
            </label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="…or paste a public Google Sheets link"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={onFetchLink} disabled={fetching || !linkUrl.trim()}>
                {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Up to {MAX_IMPORT_ROWS.toLocaleString()} rows per sheet.</p>
          </div>
        )}

        {step === "range" && (
          <div className="space-y-4">
            <RangeStep
              sheets={rawSheets}
              sheetIndex={sheetIndex}
              onSheetIndexChange={setSheetIndex}
              range={range}
              onRangeChange={setRange}
            />
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={goBack}>Back</Button>
              <Button type="button" onClick={goToMap} disabled={dataRows.length === 0}>Continue</Button>
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <MapStep headers={headers} mapping={mapping} onMappingChange={setMapping} />
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={goBack}>Back</Button>
              <Button type="button" onClick={() => setStep("resolve")}>Continue</Button>
            </div>
          </div>
        )}

        {step === "resolve" && (
          <div className="space-y-4">
            <ResolveStep
              rows={unresolvedArtistRows}
              artists={catalog.artists}
              links={links}
              onLink={linkArtist}
              onCreate={createArtistForRow}
              creatingRowIndex={creatingRowIndex}
            />
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={goBack}>Back</Button>
              <Button type="button" onClick={goToReview}>Continue</Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <ReviewStep
              rows={displayRows}
              selection={selection}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              manualEdits={manualEdits}
              onEditFee={editFee}
              onEditDate={editDate}
            />
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={goBack} disabled={submitting}>Back</Button>
              <Button type="button" onClick={handleSubmit} disabled={selection.size === 0 || submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Import {selection.size} order{selection.size === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-50">
              <CheckCircle2 className="h-6 w-6 text-accent-700" />
            </div>
            <div>
              <p className="text-lg font-medium">
                Created {result.created} draft hire order{result.created === 1 ? "" : "s"}
              </p>
              <p className="text-sm text-muted-foreground">
                {result.skippedExisting} already existed{result.error > 0 ? `, ${result.error} failed` : ""}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Close</Button>
              <Button
                type="button"
                onClick={() => { handleOpenChange(false); navigate(ROUTES.HIRE_ORDERS); }}
              >
                Open hire orders
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
