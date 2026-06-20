import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";
import { buildProgramKey, buildCityKey } from "../_shared/airtableKey.ts";
import { coerceCustomValue, type CustomFieldType } from "../_shared/customFields.ts";
import { isCancelledStatus } from "../_shared/airtableStatus.ts";

/** Max concurrent open-offer-tier invocations per batch to avoid exhausting the DB connection pool. */
const OFFER_TIER_BATCH_SIZE = 10;
const MAX_PAGES = 100;

/** Which Airtable field feeds each Showflow field (per-org, from app_settings.airtable_field_map). */
interface FieldMap {
  date?: string | null;
  program?: string | null;
  sub_program?: string | null;
  city?: string | null;
  venue?: string | null;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
  /** Airtable single-select field name whose value signals cancellation. */
  status_field?: string | null;
  /** The option string on status_field that means "cancelled". */
  cancelled_value?: string | null;
  /** Airtable field name holding the cancellation reason text. */
  cancellation_reason_field?: string | null;
}

type RecordAction = "imported_new" | "updated" | "held_unresolved" | "error";
interface RecordOutcome {
  airtable_record_id: string;
  action: RecordAction;
  show_date_id: string | null;
  reason: string | null;
  raw_fields: Record<string, unknown>;
}
interface OrgSyncResult { processed: number; new_dates: number; updated: number; held: number; tiers_opened: number }

/** Extract HH:MM from an Airtable time/ISO value; null when absent/unparseable. */
function parseTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).match(/T?(\d{2}:\d{2})(:\d{2})?/);
  return m ? m[1] : null;
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
        if (result.value.error) console.error("airtable-poll: open-offer-tier failed", { error: result.value.error });
        else opened += 1;
      } else {
        console.error("airtable-poll: open-offer-tier threw", { reason: result.reason });
      }
    }
  }
  return opened;
}

/** Notify org admins when a sync problem is NEW or worse vs. the previous run:
 *  a newly-held record (or rising held count), OR a non-empty table that just stopped
 *  importing anything (catches all-error / all-held / all-stale runs). Quiet while a
 *  known problem persists unchanged. The report UI always shows the current full state. */
async function notifyAdminsOnSyncProblem(
  deps: Deps,
  orgId: string,
  syncLogId: string,
  cur: { heldIds: string[]; importedZeroFromNonEmpty: boolean },
  prev: { heldIds: Set<string>; heldCount: number; imported: number; exists: boolean },
): Promise<void> {
  const problem = cur.heldIds.length > 0 || cur.importedZeroFromNonEmpty;
  if (!problem) return;
  const hasNewHeld = cur.heldIds.some((id) => !prev.heldIds.has(id));
  // heldCount safety net covers the rare case where prev's held_count column and its
  // record-log rows disagree (data drift); hasNewHeld covers the normal path.
  const heldWorse = hasNewHeld || cur.heldIds.length > prev.heldCount;
  // Only alarm on zero-import when the previous run was importing (or this is the first run).
  const newlyZeroImport = cur.importedZeroFromNonEmpty && (!prev.exists || prev.imported > 0);
  if (!heldWorse && !newlyZeroImport) return;

  const { data: admins } = await deps.admin.from("org_memberships").select("user_id").eq("org_id", orgId).eq("role", "admin");
  const recipients = Array.from(new Set((admins ?? []).map((a: { user_id: string }) => a.user_id)));
  if (recipients.length === 0) return;

  const message = cur.heldIds.length > 0
    ? `${cur.heldIds.length} Airtable record(s) couldn't be matched and were held. Review the Last sync report in Settings → Airtable.`
    : `The Airtable sync imported 0 records from a non-empty table. Review the Last sync report in Settings → Airtable.`;
  await deps.admin.from("notifications").insert(recipients.map((uid) => ({
    org_id: orgId,
    user_id: uid,
    type: "airtable_sync_held",
    title: "Airtable sync: needs attention",
    message,
    related_entity_type: "airtable_sync_log",
    related_entity_id: syncLogId,
  })));
}

/** Sync one org's Airtable base into its show_dates using the field map + catalog-link keys.
 *  Resolution is STRICT: shows/cities resolve only by airtable_program_key / airtable_city_key;
 *  anything unlinked is held (city is non-fatal). org_id on show_dates / record logs comes from
 *  derive triggers. Throws on Airtable API error (after logging) so handle() skips counting it. */
async function syncOrg(deps: Deps, orgId: string, baseId: string, tableName: string, apiKey: string, fieldMap: FieldMap): Promise<OrgSyncResult> {
  const admin = deps.admin;

  // ── Linked-catalog lookup maps (key → id). No name fallback, no lowercasing. ──
  const { data: shows } = await admin.from("shows").select("id, airtable_program_key").eq("org_id", orgId).limit(10000);
  const showByKey = new Map<string, string>();
  for (const s of (shows ?? []) as Array<{ id: string; airtable_program_key: string | null }>) {
    if (s.airtable_program_key) showByKey.set(s.airtable_program_key, s.id);
  }
  const { data: citiesRows } = await admin.from("cities").select("id, airtable_city_key").eq("org_id", orgId).limit(10000);
  const cityByKey = new Map<string, string>();
  for (const c of (citiesRows ?? []) as Array<{ id: string; airtable_city_key: string | null }>) {
    if (c.airtable_city_key) cityByKey.set(c.airtable_city_key, c.id);
  }

  // ── Custom field definitions (display/filter/sort only — NEVER booking logic) ──
  const { data: customDefsRaw } = await admin
    .from("custom_field_definitions")
    .select("key, source_field, type")
    .eq("org_id", orgId).eq("entity", "show_dates").eq("source", "airtable");
  const customDefs = (customDefsRaw ?? []) as Array<{ key: string; source_field: string; type: CustomFieldType }>;

  /** Build the custom jsonb bag for one record. Non-fatal: bad/missing values are omitted. */
  const buildCustom = (fields: Record<string, unknown>): Record<string, unknown> | undefined => {
    if (customDefs.length === 0) return undefined;
    const bag: Record<string, unknown> = {};
    for (const def of customDefs) {
      const coerced = coerceCustomValue(fields[def.source_field], def.type);
      if (coerced.ok) bag[def.key] = coerced.value;
    }
    return bag;
  };

  // Existing show_dates keyed by airtable_record_id (paginated to clear PostgREST's 1000-row cap).
  const existingByAirtableId = new Map<string, { id: string; status: string }>();
  {
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const { data: batch } = await admin
        .from("show_dates").select("id, airtable_record_id, status")
        .eq("org_id", orgId).not("airtable_record_id", "is", null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!batch || batch.length === 0) break;
      for (const r of batch as Array<{ id: string; airtable_record_id: string | null; status: string }>) {
        if (r.airtable_record_id) existingByAirtableId.set(r.airtable_record_id, { id: r.id, status: r.status });
      }
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  // ── Page through Airtable, classify each record ───────────────────────────
  const encodedTable = encodeURIComponent(tableName);
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`;
  const outcomes: RecordOutcome[] = [];
  const newDateIds: string[] = [];
  let processed = 0, newDates = 0, updated = 0, held = 0, recordsSeen = 0;
  let offset: string | undefined;
  let pageCount = 0;
  let apiError: string | null = null;

  do {
    pageCount += 1;
    const url = offset ? `${airtableBaseUrl}&offset=${encodeURIComponent(offset)}` : airtableBaseUrl;
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      apiError = `Airtable API error ${res.status}: ${body}`;
      console.error("airtable-poll: Airtable API error", { org: orgId, status: res.status, body });
      break;
    }
    const pageData = await res.json();
    offset = pageData.offset;
    for (const record of (pageData.records ?? []) as Array<{ id: string; fields: Record<string, unknown> }>) {
      recordsSeen += 1;
      const fields = record.fields;
      const id = record.id;

      const dateValue = fieldMap.date ? fields[fieldMap.date] ?? null : null;
      if (!dateValue) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: "missing date", raw_fields: fields }); continue; }

      const subProgramValue = fieldMap.sub_program ? fields[fieldMap.sub_program] ?? null : null;
      const programKey = buildProgramKey(null, subProgramValue == null ? null : String(subProgramValue));
      const showId = programKey ? showByKey.get(programKey) ?? null : null;
      if (!showId) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: `program '${subProgramValue ?? ""}' not linked`, raw_fields: fields }); continue; }

      const cityValue = fieldMap.city ? fields[fieldMap.city] ?? null : null;
      const cityKey = buildCityKey(cityValue == null ? null : String(cityValue));
      const cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      const cityNote = cityValue && !cityId ? `city '${cityValue}' not linked` : null;

      const session1 = fieldMap.session_1 ? parseTime(fields[fieldMap.session_1]) : null;
      const session2 = fieldMap.session_2 ? parseTime(fields[fieldMap.session_2]) : null;
      const session3 = fieldMap.session_3 ? parseTime(fields[fieldMap.session_3]) : null;
      const venue = fieldMap.venue ? (fields[fieldMap.venue] ?? null) : null;
      const statusRaw = fieldMap.status_field ? fields[fieldMap.status_field] ?? null : null;
      const isCancelled = isCancelledStatus(statusRaw, fieldMap.cancelled_value);
      const reason = fieldMap.cancellation_reason_field ? (fields[fieldMap.cancellation_reason_field] ?? null) : null;

      const existing = existingByAirtableId.get(id);
      const existingId = existing?.id;
      if (existingId) {
        const payload: Record<string, unknown> = { date: dateValue };
        if (session1 !== null) payload.session_1 = session1;
        if (session2 !== null) payload.session_2 = session2;
        if (session3 !== null) payload.session_3 = session3;
        if (venue !== null) payload.venue = venue;
        if (cityId !== null) payload.city_id = cityId;
        const customBag = buildCustom(fields);
        if (customBag !== undefined) payload.custom = customBag;
        if (isCancelled) {
          payload.status = "cancelled";
          payload.cancellation_reason = reason == null ? null : String(reason);
        } else if (existing?.status === "cancelled") {
          payload.status = "open";            // revival: bookings were released; date starts fresh
          payload.cancellation_reason = null;
        }
        const { error } = await admin.from("show_dates").update(payload).eq("id", existingId);
        if (error) { outcomes.push({ airtable_record_id: id, action: "error", show_date_id: existingId, reason: error.message, raw_fields: fields }); continue; }
        processed += 1; updated += 1;
        outcomes.push({ airtable_record_id: id, action: "updated", show_date_id: existingId, reason: cityNote, raw_fields: fields });
        continue;
      }

      // org_id is set by the derive trigger from show_id. session_1 is NOT NULL → default 00:00.
      const insertPayload: Record<string, unknown> = { show_id: showId, date: dateValue, airtable_record_id: id, city_id: cityId, session_1: session1 ?? "00:00" };
      if (session2 !== null) insertPayload.session_2 = session2;
      if (session3 !== null) insertPayload.session_3 = session3;
      if (venue !== null) insertPayload.venue = venue;
      const customBagNew = buildCustom(fields);
      if (customBagNew !== undefined) insertPayload.custom = customBagNew;
      if (isCancelled) {
        insertPayload.status = "cancelled";
        insertPayload.cancellation_reason = reason == null ? null : String(reason);
      }
      const { data: inserted, error: insertErr } = await admin.from("show_dates").insert(insertPayload).select("id").single();
      if (insertErr || !inserted?.id) { outcomes.push({ airtable_record_id: id, action: "error", show_date_id: null, reason: insertErr?.message ?? "insert returned no id", raw_fields: fields }); continue; }
      processed += 1; newDates += 1;
      newDateIds.push(inserted.id);
      existingByAirtableId.set(id, { id: inserted.id, status: isCancelled ? "cancelled" : "open" });
      outcomes.push({ airtable_record_id: id, action: "imported_new", show_date_id: inserted.id, reason: cityNote, raw_fields: fields });
    }
  } while (!apiError && offset && pageCount < MAX_PAGES);

  const truncated = pageCount >= MAX_PAGES && !!offset;
  if (truncated) console.warn("airtable-poll: reached MAX_PAGES limit; sync may be incomplete", { org: orgId });

  // Flush tier-1 offers for new dates (resilient batch).
  const tiersOpened = await openOfferTierBatch(deps, newDateIds);
  const tiersFailed = newDateIds.length - tiersOpened;

  // Previous run's held set (fetched BEFORE inserting this run's log) for change-only notify.
  const { data: prevLog } = await admin
    .from("airtable_sync_log").select("id, held_count, imported_count")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  let prevHeldIds = new Set<string>();
  let prevHeldCount = 0;
  let prevImported = 0;
  if (prevLog?.id) {
    prevHeldCount = (prevLog.held_count as number | null) ?? 0;
    prevImported = (prevLog.imported_count as number | null) ?? 0;
    const { data: prevHeld } = await admin
      .from("airtable_sync_record_log").select("airtable_record_id")
      .eq("sync_log_id", prevLog.id).eq("action", "held_unresolved");
    prevHeldIds = new Set((prevHeld ?? []).map((r: { airtable_record_id: string | null }) => r.airtable_record_id ?? ""));
  }

  const errored = outcomes.filter((o) => o.action === "error").length;
  const status = apiError ? "error" : (held > 0 || errored > 0 ? "partial" : "success");
  const parts: string[] = [];
  if (apiError) parts.push(apiError);
  if (truncated) parts.push(`Reached MAX_PAGES (${MAX_PAGES}); sync is incomplete`);
  if (tiersFailed > 0) parts.push(`${tiersFailed} of ${newDateIds.length} open-offer-tier calls failed`);
  if (held > 0) parts.push(`${held} record(s) held (unresolved)`);
  if (errored > 0) parts.push(`${errored} record(s) errored`);

  const { data: logRow } = await admin.from("airtable_sync_log").insert({
    org_id: orgId,
    sync_type: "airtable_poll",
    status,
    records_processed: processed,
    imported_count: processed,
    new_count: newDates,
    updated_count: updated,
    held_count: held,
    details: { truncated, new: newDates, updated, held, errored, records_seen: recordsSeen },
    error_details: parts.length ? parts.join("; ") : null,
    synced_at: deps.now().toISOString(),
  }).select("id").single();
  const syncLogId = (logRow as { id?: string } | null)?.id ?? null;

  const heldIds = outcomes.filter((o) => o.action === "held_unresolved").map((o) => o.airtable_record_id);
  if (syncLogId && outcomes.length) {
    await admin.from("airtable_sync_record_log").insert(outcomes.map((o) => ({
      sync_log_id: syncLogId,
      airtable_record_id: o.airtable_record_id,
      action: o.action,
      show_date_id: o.show_date_id,
      reason: o.reason,
      raw_fields: o.raw_fields,
    })));
    const importedZeroFromNonEmpty = recordsSeen > 0 && processed === 0;
    await notifyAdminsOnSyncProblem(
      deps, orgId, syncLogId,
      { heldIds, importedZeroFromNonEmpty },
      { heldIds: prevHeldIds, heldCount: prevHeldCount, imported: prevImported, exists: !!prevLog?.id },
    );
  }

  if (apiError) {
    throw { httpStatus: 502, body: { error: apiError, org_id: orgId, new_dates: newDates, tiers_opened: tiersOpened } };
  }
  return { processed, new_dates: newDates, updated, held, tiers_opened: tiersOpened };
}

/**
 * Polls Airtable per ACTIVE org, resolving records against the org's field map + catalog-link keys,
 * upserting show_dates, logging every record's outcome, and opening tier-1 offers for new dates.
 *
 * Per active org it resolves (org override ?? platform default): airtable_sync_enabled,
 * airtable_base_id, airtable_table_name, airtable_field_map; and the Vault key via get_org_airtable_key.
 * An enabled-but-misconfigured org (bad base / missing base|table|key) leaves a visible error log row.
 * Disabled orgs are skipped silently. One org's failure never aborts the others.
 *
 * Auth: X-Cron-Secret header (pg_cron, platform cron_secret row). Cron-only — no user JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;

  const cronSecretHeader = req.headers.get("X-Cron-Secret");
  if (!cronSecretHeader) return json({ error: "Unauthorized" }, 401);
  const { data: secretSetting } = await admin
    .from("app_settings").select("value").eq("key", "cron_secret").is("org_id", null).maybeSingle();
  if (cronSecretHeader !== ((secretSetting?.value as string | null) ?? "")) return json({ error: "Unauthorized" }, 401);

  let orgs: Array<{ id: string }>;
  try {
    orgs = await getActiveOrgs(admin);
  } catch (e) {
    console.error("airtable-poll: failed to fetch active orgs", { error: (e as Error).message });
    return json({ error: "failed to fetch active orgs" }, 500);
  }

  const totals = { orgs_synced: 0, processed: 0, new_dates: 0, updated: 0, held: 0, tiers_opened: 0 };

  for (const org of orgs) {
    try {
      const enabled = await resolveOrgSetting<boolean>(admin, org.id, "airtable_sync_enabled", false);
      if (!enabled) continue; // intentionally off → skip silently

      const baseId = await resolveOrgSetting<string | null>(admin, org.id, "airtable_base_id", null);
      const tableName = await resolveOrgSetting<string | null>(admin, org.id, "airtable_table_name", null);
      const fieldMap = await resolveOrgSetting<FieldMap>(admin, org.id, "airtable_field_map", {});

      const logMisconfig = (detail: string) =>
        admin.from("airtable_sync_log").insert({ org_id: org.id, sync_type: "airtable_poll", status: "error", records_processed: 0, imported_count: 0, new_count: 0, updated_count: 0, held_count: 0, error_details: detail, synced_at: deps.now().toISOString() });

      if (!baseId || !tableName) { await logMisconfig("Airtable sync enabled but base_id or table_name is not configured"); continue; }
      if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) { await logMisconfig("airtable_base_id has unexpected format; expected app + 14 alphanumeric chars"); continue; }
      if (!fieldMap?.date || !fieldMap?.sub_program) { await logMisconfig("Airtable field map incomplete: 'date' and 'sub_program' must be mapped"); continue; }

      const { data: apiKey } = await admin.rpc("get_org_airtable_key", { _org: org.id });
      if (!apiKey) { await logMisconfig("Airtable sync enabled but no API key is configured in the Vault"); continue; }

      const r = await syncOrg(deps, org.id, baseId, tableName, apiKey as string, fieldMap);
      totals.orgs_synced += 1;
      totals.processed += r.processed;
      totals.new_dates += r.new_dates;
      totals.updated += r.updated;
      totals.held += r.held;
      totals.tiers_opened += r.tiers_opened;
    } catch (e) {
      console.error("airtable-poll: org sync failed", { org: org.id, error: (e as { body?: unknown })?.body ?? (e as Error).message });
      // continue; any sync_log row was already written inside syncOrg / the misconfig guards.
    }
  }

  return json(totals);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
