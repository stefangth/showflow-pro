import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { requireFeature } from "../_shared/entitlements.ts";
import { resolveBookingFlow } from "../_shared/bookingFlow.ts";
import { checkFeature } from "../_shared/entitlements.ts";
import { buildProgramKey, buildCityKey } from "../_shared/airtableKey.ts";
import type { Json, TablesInsert } from "../_shared/database.types.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/** Max concurrent open-offer-tier invocations per batch (mirrors airtable-poll). */
const OFFER_TIER_BATCH_SIZE = 10;

/**
 * One client-mapped Google Sheet row. Mirrors `SheetDateRaw` from
 * `src/lib/sheetImport/mapRows.ts` (the client's `mapSheetRows` output). Re-declared
 * locally rather than imported: edge code is a separate Deno root/tsconfig from `src/`
 * (mapRows.ts itself imports `@/lib/artistImport/parseSheet`, a src/-only path), so a
 * cross-root import isn't viable here.
 */
interface SheetDateRaw {
  program: string;
  subProgram: string;
  date: string;
  city: string;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  /** 1-based source row index, for held-cause reporting. */
  rowIndex: number;
}

/** A row resolved against the org catalog, ready for `import_sheet_dates`. */
interface ResolvedRow {
  show_id: string;
  date: string;
  city_id: string | null;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
}

type RecordAction = "imported_new" | "updated" | "held_unresolved";
interface RecordOutcome {
  action: RecordAction;
  show_date_id: string | null;
  reason: string | null;
  raw_fields: Record<string, unknown>;
  /** Synthetic per-row identifier (sheets have no natural record id like Airtable). */
  row_ref: string;
}

async function openOfferTierBatch(deps: Deps, ids: string[]): Promise<number> {
  let opened = 0;
  for (let i = 0; i < ids.length; i += OFFER_TIER_BATCH_SIZE) {
    const batch = ids.slice(i, i + OFFER_TIER_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => deps.invokeFunction("open-offer-tier", { show_date_id: id, tier: 1 })),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.error) console.error("import-sheet-dates: open-offer-tier failed", { error: result.value.error });
        else opened += 1;
      } else {
        console.error("import-sheet-dates: open-offer-tier threw", { reason: result.reason });
      }
    }
  }
  return opened;
}

/**
 * Google Sheet -> show_dates importer. Reduced-scope mirror of airtable-poll's `syncOrg`:
 * ONE org, client-already-parsed rows (no CSV fetch here, no SSRF concern), and matched
 * against the catalog by plain (program, sub_program) / city name instead of the
 * Airtable-linked-key columns.
 *
 * Auth: JWT-only (producer or admin of `org_id`; super-admins pass via requireOrgRole).
 * No X-Cron-Secret path this phase — this is a user-triggered import, never a cron.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  let body: { org_id?: string; rows?: SheetDateRaw[] } = {};
  try { body = await req.json(); } catch { /* empty/invalid body -> handled below */ }
  const orgId = body?.org_id;
  const rows = body?.rows ?? [];
  if (!orgId) return json({ error: "org_id required" }, 400);

  const auth = await requireOrgRole(deps, req, orgId, ["producer", "admin"]);
  if (!auth.ok) return auth.response;

  const featureGate = await requireFeature(deps, orgId, "booking_flow");
  if (featureGate) return featureGate;

  // ── Catalog lookup maps: plain (program, sub_program) / city name, lowercased. ──
  const { data: showsRaw } = await admin.from("shows").select("id, program, sub_program").eq("org_id", orgId).limit(10000);
  const showByKey = new Map<string, string>();
  for (const s of (showsRaw ?? []) as Array<{ id: string; program: string | null; sub_program: string | null }>) {
    const key = buildProgramKey((s.program ?? "").toLowerCase(), (s.sub_program ?? "").toLowerCase());
    if (key) showByKey.set(key, s.id);
  }
  const { data: citiesRaw } = await admin.from("cities").select("id, name").eq("org_id", orgId).limit(10000);
  const cityByKey = new Map<string, string>();
  for (const c of (citiesRaw ?? []) as Array<{ id: string; name: string | null }>) {
    const key = buildCityKey(c.name);
    if (key) cityByKey.set(key, c.id);
  }

  // ── Resolve each row: missing date -> held; unresolved program -> held; a NEW row's
  //    non-empty unresolved city -> held (city-hold, mirrors airtable-poll); blank city
  //    imports city-less. ──
  const resolvedRows: ResolvedRow[] = [];
  const heldOutcomes: RecordOutcome[] = [];
  // Parallel to resolvedRows — the original row + row_ref, so record-log rows for
  // imported/updated outcomes can be built once the RPC result (and reconciliation
  // select below) tells us which resolved row landed where.
  const resolvedSources: Array<{ row: SheetDateRaw; row_ref: string; key: string }> = [];

  for (const row of rows) {
    const rowRef = `sheet-row-${row.rowIndex}`;
    const rawFields = row as unknown as Record<string, unknown>;
    const date = (row.date ?? "").trim();
    if (!date) {
      heldOutcomes.push({ action: "held_unresolved", show_date_id: null, reason: "missing date", raw_fields: rawFields, row_ref: rowRef });
      continue;
    }

    const program = (row.program ?? "").trim();
    const subProgram = (row.subProgram ?? "").trim();
    const programKey = buildProgramKey(program.toLowerCase(), subProgram.toLowerCase());
    const showId = programKey ? showByKey.get(programKey) ?? null : null;
    if (!showId) {
      heldOutcomes.push({
        action: "held_unresolved", show_date_id: null,
        reason: `program '${subProgram}' not linked`, raw_fields: rawFields, row_ref: rowRef,
      });
      continue;
    }

    const city = (row.city ?? "").trim();
    let cityId: string | null = null;
    if (city) {
      const cityKey = buildCityKey(city);
      cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      if (!cityId) {
        heldOutcomes.push({
          action: "held_unresolved", show_date_id: null,
          reason: `city '${city}' not linked`, raw_fields: rawFields, row_ref: rowRef,
        });
        continue;
      }
    }

    resolvedRows.push({
      show_id: showId, date, city_id: cityId,
      session_1: row.session_1, session_2: row.session_2, session_3: row.session_3, venue: row.venue,
    });
    resolvedSources.push({ row, row_ref: rowRef, key: `${showId}|${date}` });
  }

  const heldCount = heldOutcomes.length;

  const logMisconfig = async (detail: string) => {
    await admin.from("airtable_sync_log").insert({
      org_id: orgId, sync_type: "sheet_import", status: "error",
      records_processed: 0, imported_count: 0, new_count: 0, updated_count: 0, held_count: heldCount,
      details: null, error_details: detail, synced_at: deps.now().toISOString(),
    });
  };

  let newCount = 0, updatedCount = 0;
  let newIds: string[] = [];
  const importOutcomes: RecordOutcome[] = [];

  if (resolvedRows.length > 0) {
    const { data: rpcResult, error: rpcError } = await admin.rpc("import_sheet_dates", {
      p_org: orgId,
      p_rows: resolvedRows as unknown as Json,
    });
    if (rpcError) {
      await logMisconfig(rpcError.message);
      return json({ error: "import failed" }, 500);
    }
    const result = rpcResult as { new_count?: number; updated_count?: number; new_ids?: string[] } | null;
    newCount = result?.new_count ?? 0;
    updatedCount = result?.updated_count ?? 0;
    newIds = result?.new_ids ?? [];

    // Reconcile which resolved row landed as new vs. updated, for the record-log
    // (the RPC returns counts + new_ids, not a per-row mapping). This select is
    // ONLY for logging — tier-1 opening below uses `newIds` from the RPC directly
    // (controller ruling), never this reconciliation.
    const newIdSet = new Set(newIds);
    const showIds = Array.from(new Set(resolvedRows.map((r) => r.show_id)));
    const dates = Array.from(new Set(resolvedRows.map((r) => r.date)));
    const { data: landedRaw } = await admin
      .from("show_dates").select("id, show_id, date")
      .eq("org_id", orgId).eq("source", "sheet")
      .in("show_id", showIds).in("date", dates);
    const landedByKey = new Map<string, string>();
    for (const r of (landedRaw ?? []) as Array<{ id: string; show_id: string; date: string }>) {
      landedByKey.set(`${r.show_id}|${r.date}`, r.id);
    }

    for (const src of resolvedSources) {
      const showDateId = landedByKey.get(src.key) ?? null;
      const action: RecordAction = showDateId && newIdSet.has(showDateId) ? "imported_new" : "updated";
      importOutcomes.push({
        action, show_date_id: showDateId, reason: null,
        raw_fields: src.row as unknown as Record<string, unknown>, row_ref: src.row_ref,
      });
    }
  }

  const outcomes = [...importOutcomes, ...heldOutcomes];
  const processed = rows.length;

  // ── Tier-1 offers for NEW dates only, gated on the org's booking flow (mirrors
  //    airtable-poll: all four switches, resolveBookingFlow already folds in the
  //    booking_flow entitlement check). ──
  let tiersOpened = 0;
  if (newIds.length > 0) {
    const flow = await resolveBookingFlow(admin, orgId);
    if (flow.active && flow.auto_open_tier1 && flow.artist_acceptance && await checkFeature(admin, orgId, "booking_flow")) {
      tiersOpened = await openOfferTierBatch(deps, newIds);
    }
  }

  // ── sync-log observability (same column set as airtable-poll, sync_type="sheet_import"). ──
  const status = heldCount > 0 ? "partial" : "success";
  const details = { new: newCount, updated: updatedCount, held: heldCount, records_seen: processed };
  const { data: logRow } = await admin.from("airtable_sync_log").insert({
    org_id: orgId,
    sync_type: "sheet_import",
    status,
    records_processed: processed,
    imported_count: resolvedRows.length,
    new_count: newCount,
    updated_count: updatedCount,
    held_count: heldCount,
    details: details as Json,
    synced_at: deps.now().toISOString(),
  }).select("id").single();
  const syncLogId = (logRow as { id?: string } | null)?.id ?? null;

  if (syncLogId && outcomes.length) {
    const recordRows = outcomes.map((o): Omit<TablesInsert<"airtable_sync_record_log">, "org_id"> => ({
      sync_log_id: syncLogId,
      airtable_record_id: o.row_ref,
      action: o.action,
      show_date_id: o.show_date_id,
      reason: o.reason,
      raw_fields: o.raw_fields as Json,
    }));
    await admin.from("airtable_sync_record_log").insert(recordRows as TablesInsert<"airtable_sync_record_log">[]);
  }

  return json({ processed, new_dates: newCount, updated: updatedCount, held: heldCount, tiers_opened: tiersOpened });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
