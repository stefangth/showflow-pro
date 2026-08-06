import { preflight, json } from "../_shared/http.ts";
import { requireCronSecret, requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import type { Json, TablesInsert, TablesUpdate } from "../_shared/database.types.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";
import { checkFeature } from "../_shared/entitlements.ts";
import { resolveBookingFlow } from "../_shared/bookingFlow.ts";
import { buildProgramKey, buildCityKey } from "../_shared/airtableKey.ts";
import { coerceCustomValue, type CustomFieldType } from "../_shared/customFields.ts";
import { isCancelledStatus } from "../_shared/airtableStatus.ts";

/** Max concurrent open-offer-tier invocations per batch to avoid exhausting the DB connection pool. */
const OFFER_TIER_BATCH_SIZE = 10;
const MAX_PAGES = 100;

/** Poll-interval floor + jitter grace. Mirrors src/lib/airtablePoll.ts (two runtimes,
 *  no shared import). The 5-min floor matches the master cron tick; the 60s grace keeps
 *  a 5-min interval polling every tick despite cron dispatch jitter. */
const MIN_POLL_INTERVAL_MINUTES = 5;
const POLL_GRACE_MS = 60_000;
function clampIntervalMinutes(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_POLL_INTERVAL_MINUTES ? n : MIN_POLL_INTERVAL_MINUTES;
}

/** Most recent airtable_poll attempt for an org (null = never). Drives the interval gate. */
async function fetchLastPollAt(admin: Deps["admin"], orgId: string): Promise<Date | null> {
  const { data } = await admin
    .from("airtable_sync_log").select("synced_at")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  const ts = (data as { synced_at?: string } | null)?.synced_at;
  return ts ? new Date(ts) : null;
}

/** Which Airtable field feeds each ShowFlow field (per-org, from app_settings.airtable_field_map). */
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

interface MetaField { id: string; name: string; type: string; options?: { linkedTableId?: string } }
interface MetaTable { id: string; name: string; primaryFieldId?: string; fields?: MetaField[] }

/** Fetch the base's table schema (meta API). Returns null if unavailable (e.g. the PAT lacks
 *  schema scope) — callers then fall back to passthrough, preserving current behavior. */
async function fetchBaseTables(deps: Deps, baseId: string, apiKey: string): Promise<MetaTable[] | null> {
  try {
    const res = await deps.fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) { console.warn("airtable-poll: base schema unavailable", { baseId, status: res.status }); return null; }
    const data = await res.json();
    return Array.isArray(data?.tables) ? (data.tables as MetaTable[]) : null;
  } catch (e) {
    console.warn("airtable-poll: base schema fetch threw", { baseId, error: (e as Error).message });
    return null;
  }
}

/** Build a recordId → primary-field-name map for one linked table. Best-effort; partial/empty on error. */
async function fetchLinkedNameMap(deps: Deps, baseId: string, linkedTableId: string, primaryFieldId: string, apiKey: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ returnFieldsByFieldId: "true" });
    params.append("fields[]", primaryFieldId);
    if (offset) params.set("offset", offset);
    const res = await deps.fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(linkedTableId)}?${params.toString()}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) { console.warn("airtable-poll: linked table fetch failed", { linkedTableId, status: res.status }); break; }
    const data = await res.json();
    for (const r of (data.records ?? []) as Array<{ id: string; fields?: Record<string, unknown> }>) {
      const v = r.fields?.[primaryFieldId];
      if (v != null) map.set(r.id, String(v));
    }
    offset = data.offset;
    pages += 1;
  } while (offset && pages < MAX_PAGES);
  return map;
}

/** Resolve an Airtable cell to display name(s). With a linkMap (multipleRecordLinks field), record
 *  IDs → names (unknown IDs dropped). Without one (text/select), values pass through as strings. */
function resolveNames(raw: unknown, linkMap?: Map<string, string>): string[] {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of arr) {
    if (linkMap) {
      if (typeof v === "string" && linkMap.has(v)) out.push(linkMap.get(v)!);
    } else if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
    }
  }
  return out;
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
async function syncOrg(deps: Deps, orgId: string, baseId: string, tableName: string, apiKey: string, fieldMap: FieldMap, viewName: string): Promise<OrgSyncResult> {
  const admin = deps.admin;

  // ── Linked-catalog lookup maps (key → id). No name fallback, no lowercasing. ──
  const { data: shows } = await admin.from("shows").select("id, program, airtable_program_key").eq("org_id", orgId).limit(10000);
  const showByKey = new Map<string, { id: string; program: string | null }>();
  for (const s of (shows ?? []) as Array<{ id: string; program: string | null; airtable_program_key: string | null }>) {
    if (s.airtable_program_key) showByKey.set(s.airtable_program_key, { id: s.id, program: s.program });
  }
  const { data: citiesRows } = await admin.from("cities").select("id, airtable_city_key").eq("org_id", orgId).limit(10000);
  const cityByKey = new Map<string, string>();
  for (const c of (citiesRows ?? []) as Array<{ id: string; airtable_city_key: string | null }>) {
    if (c.airtable_city_key) cityByKey.set(c.airtable_city_key, c.id);
  }

  // ── Resolve linked-record fields (venue/city) to display names when mapped to a
  //    multipleRecordLinks Airtable field. Best-effort: if the schema is unavailable,
  //    linkMaps stay empty and values pass through unchanged. ──
  const linkMaps: { venue?: Map<string, string>; city?: Map<string, string> } = {};
  if (fieldMap.venue || fieldMap.city) {
    const metaTables = await fetchBaseTables(deps, baseId, apiKey);
    if (metaTables) {
      const target = metaTables.find((t) => t.name === tableName);
      const fieldByName = new Map((target?.fields ?? []).map((f) => [f.name, f] as const));
      const primaryByTableId = new Map(metaTables.map((t) => [t.id, t.primaryFieldId] as const));
      // venue + city are independent — resolve their linked tables in parallel.
      await Promise.all((["venue", "city"] as const).map(async (key) => {
        const fname = fieldMap[key];
        if (!fname) return;
        const f = fieldByName.get(fname);
        const linkedTableId = f?.type === "multipleRecordLinks" ? f.options?.linkedTableId : undefined;
        const primaryFieldId = linkedTableId ? primaryByTableId.get(linkedTableId) : undefined;
        if (linkedTableId && primaryFieldId) {
          linkMaps[key] = await fetchLinkedNameMap(deps, baseId, linkedTableId, primaryFieldId, apiKey);
        }
      }));
    }
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
  const dataUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}`;
  // A named view scopes (and can filter) which records sync; a blank view reads the table's
  // full record set. encodeURIComponent keeps spaces as %20 (e.g. "Grid view" → "Grid%20view").
  const viewParam = viewName ? `view=${encodeURIComponent(viewName)}` : null;
  const outcomes: RecordOutcome[] = [];
  const newDateIds: string[] = [];
  // Existing dates whose upsert payload gained a session this run — candidates for a
  // late tier-1 auto-open (a date synced before its session times were filled in).
  const updatedWithSession: string[] = [];
  let processed = 0, newDates = 0, updated = 0, held = 0, recordsSeen = 0;
  let offset: string | undefined;
  let pageCount = 0;
  let apiError: string | null = null;

  do {
    pageCount += 1;
    const params = [viewParam, offset ? `offset=${encodeURIComponent(offset)}` : null].filter((p): p is string => Boolean(p));
    const url = params.length ? `${dataUrl}?${params.join("&")}` : dataUrl;
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

      // Airtable date fields arrive as ISO strings; the raw field value is unknown.
      const dateValue = fieldMap.date ? (fields[fieldMap.date] as string | null | undefined) ?? null : null;
      if (!dateValue) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: "missing date", raw_fields: fields }); continue; }

      const subProgramRaw = fieldMap.sub_program ? fields[fieldMap.sub_program] ?? null : null;
      const subProgramValue = subProgramRaw == null ? null : String(subProgramRaw);
      const programRaw = fieldMap.program ? fields[fieldMap.program] ?? null : null;
      const programValue = programRaw == null ? null : (String(programRaw).trim() || null);

      // Composite grain (ADR-0010): program present → "program|sub_program"; else sub_program alone.
      const programKey = buildProgramKey(programValue, subProgramValue);
      const legacyKey = buildProgramKey(null, subProgramValue);
      let resolved = programKey ? showByKey.get(programKey) ?? null : null;
      let showId = resolved?.id ?? null;

      // Transition self-heal: a show still keyed sub-program-only is adopted to the composite
      // grain (re-keyed + program backfilled) so its existing dates keep resolving. Idempotent —
      // the in-memory map is updated so later records in this run hit the composite key directly.
      // Assumes one program per sub_program (the legacy key maps to a single show); if a base ever
      // reuses one sub_program across programs, only the first program's records adopt the legacy show.
      if (!showId && programKey && legacyKey && legacyKey !== programKey) {
        const legacy = showByKey.get(legacyKey);
        if (legacy) {
          const { error: rekeyErr } = await admin.from("shows")
            .update({ airtable_program_key: programKey, program: programValue }).eq("id", legacy.id);
          if (!rekeyErr) {
            showByKey.delete(legacyKey);
            resolved = { id: legacy.id, program: programValue };
            showByKey.set(programKey, resolved);
            showId = legacy.id;
          } else {
            console.error("airtable-poll: re-key update failed", { org: orgId, legacyKey, programKey, error: rekeyErr.message });
          }
        }
      }

      if (!showId) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: `program '${subProgramValue ?? ""}' not linked`, raw_fields: fields }); continue; }

      // Keep shows.program current with Airtable (fills the column on already-composite shows).
      if (programValue !== null && resolved && resolved.program !== programValue) {
        const { error: progErr } = await admin.from("shows").update({ program: programValue }).eq("id", showId);
        if (progErr) {
          console.error("airtable-poll: program write-through failed", { org: orgId, programKey, error: progErr.message });
        } else {
          resolved.program = programValue; // in-place — showByKey already holds this reference
        }
      }

      const cityNames = fieldMap.city ? resolveNames(fields[fieldMap.city], linkMaps.city) : [];
      const cityRawName = cityNames[0] ?? null;
      const cityKey = buildCityKey(cityRawName);
      const cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      const cityNote = cityRawName && !cityId ? `city '${cityRawName}' not linked` : null;

      const session1 = fieldMap.session_1 ? parseTime(fields[fieldMap.session_1]) : null;
      const session2 = fieldMap.session_2 ? parseTime(fields[fieldMap.session_2]) : null;
      const session3 = fieldMap.session_3 ? parseTime(fields[fieldMap.session_3]) : null;
      const venueNames = fieldMap.venue ? resolveNames(fields[fieldMap.venue], linkMaps.venue) : [];
      const venue = venueNames.length ? venueNames.join(", ") : null;
      const statusRaw = fieldMap.status_field ? fields[fieldMap.status_field] ?? null : null;
      const isCancelled = isCancelledStatus(statusRaw, fieldMap.cancelled_value);
      const reason = fieldMap.cancellation_reason_field ? (fields[fieldMap.cancellation_reason_field] ?? null) : null;

      const existing = existingByAirtableId.get(id);
      const existingId = existing?.id;
      if (existingId) {
        const payload: TablesUpdate<"show_dates"> = { date: dateValue };
        if (fieldMap.session_1) payload.session_1 = session1;
        if (fieldMap.session_2) payload.session_2 = session2;
        if (fieldMap.session_3) payload.session_3 = session3;
        if (venue !== null) payload.venue = venue;
        if (cityId !== null) payload.city_id = cityId;
        const customBag = buildCustom(fields);
        if (customBag !== undefined) payload.custom = customBag as Json;
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
        if (payload.session_1 || payload.session_2 || payload.session_3) updatedWithSession.push(existingId);
        outcomes.push({ airtable_record_id: id, action: "updated", show_date_id: existingId, reason: cityNote, raw_fields: fields });
        continue;
      }

      // org_id is set by the derive trigger from show_id — the generated Insert
      // type can't know that, hence the Omit + single cast at the insert below.
      const insertPayload: Omit<TablesInsert<"show_dates">, "org_id"> = { show_id: showId, date: dateValue, airtable_record_id: id, city_id: cityId };
      if (fieldMap.session_1) insertPayload.session_1 = session1;
      if (fieldMap.session_2) insertPayload.session_2 = session2;
      if (fieldMap.session_3) insertPayload.session_3 = session3;
      if (venue !== null) insertPayload.venue = venue;
      const customBagNew = buildCustom(fields);
      if (customBagNew !== undefined) insertPayload.custom = customBagNew as Json;
      if (isCancelled) {
        insertPayload.status = "cancelled";
        insertPayload.cancellation_reason = reason == null ? null : String(reason);
      }
      const { data: inserted, error: insertErr } = await admin.from("show_dates").insert(insertPayload as TablesInsert<"show_dates">).select("id").single();
      if (insertErr || !inserted?.id) { outcomes.push({ airtable_record_id: id, action: "error", show_date_id: null, reason: insertErr?.message ?? "insert returned no id", raw_fields: fields }); continue; }
      processed += 1; newDates += 1;
      newDateIds.push(inserted.id);
      existingByAirtableId.set(id, { id: inserted.id, status: isCancelled ? "cancelled" : "open" });
      outcomes.push({ airtable_record_id: id, action: "imported_new", show_date_id: inserted.id, reason: cityNote, raw_fields: fields });
    }
  } while (!apiError && offset && pageCount < MAX_PAGES);

  const truncated = pageCount >= MAX_PAGES && !!offset;
  if (truncated) console.warn("airtable-poll: reached MAX_PAGES limit; sync may be incomplete", { org: orgId });

  // Flush tier-1 offers (resilient batch), gated on the org's booking flow. Resolve the
  // flow once per org. Gate on ALL THREE switches: the booking_flow module entitlement
  // (bookingEnabled — LOAD-BEARING: this is one of only two paths, alongside
  // expire-offers' auto-escalation, where a service-role/cron caller can open a tier
  // without ever going through open-offer-tier's own JWT-only requireFeature gate;
  // resolveBookingFlow itself fails open to permissive defaults, including
  // auto_open_tier1: true, on an entitlement-check failure, so flow.auto_open_tier1
  // alone is NOT a safe gate for an unentitled org), auto_open_tier1 (owner turned
  // auto-open off), AND artist_acceptance — a direct-booking org has no offer step, and
  // open-offer-tier now 409s in direct mode (Task 8), so the acceptance half avoids
  // pointless failing invokes. Only the auto-open is gated; the date sync above always runs.
  let tiersOpened = 0;
  let tiersAttempted = 0;
  const flow = await resolveBookingFlow(admin, orgId);
  const bookingEnabled = await checkFeature(admin, orgId, "booking_flow");
  if (bookingEnabled && flow.auto_open_tier1 && flow.artist_acceptance) {
    let candidates = [...newDateIds];
    // Also cover UPDATED dates that just gained a session but have no tier-1 row yet.
    // Over-inclusion is safe: open-offer-tier no-ops benignly for not-ready dates, so no
    // readiness check is needed beyond "the payload gained a session".
    // Accepted race: this read runs before this run's open-offer-tier calls commit, so
    // two overlapping polls for one org (slow cron tick plus "Sync now") can both pass
    // it and double-invoke. The loser is rejected by open-offer-tier (the tier row and
    // bookings are DB-unique) and shows up as a failed invoke in the log; that noise is
    // accepted rather than adding a cross-invocation lock.
    if (updatedWithSession.length) {
      const { data: existingTierRows } = await admin
        .from("show_date_offer_tiers")
        .select("show_date_id")
        .in("show_date_id", updatedWithSession)
        .eq("tier", 1);
      const already = new Set((existingTierRows ?? []).map((r: { show_date_id: string }) => r.show_date_id));
      candidates = candidates.concat(updatedWithSession.filter((id) => !already.has(id)));
    }
    tiersAttempted = candidates.length;
    tiersOpened = await openOfferTierBatch(deps, candidates);
  }
  const tiersFailed = tiersAttempted - tiersOpened;

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
  if (tiersFailed > 0) parts.push(`${tiersFailed} of ${tiersAttempted} open-offer-tier calls failed`);
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
    // org_id is derived by trg_derive_org_id from sync_log_id (20260617164248) —
    // the generated Insert type can't know that, hence the Omit + single cast.
    const recordRows = outcomes.map((o): Omit<TablesInsert<"airtable_sync_record_log">, "org_id"> => ({
      sync_log_id: syncLogId,
      airtable_record_id: o.airtable_record_id,
      action: o.action,
      show_date_id: o.show_date_id,
      reason: o.reason,
      raw_fields: o.raw_fields as Json,
    }));
    await admin.from("airtable_sync_record_log").insert(recordRows as TablesInsert<"airtable_sync_record_log">[]);
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
 * Resolve one org's Airtable sync config, run the misconfig guards, and sync it.
 * Returns the per-org result, or null when the org is misconfigured (an error
 * sync_log row was already written) so the caller skips its totals. Shared by the
 * cron loop (per active org) and the manual "Sync now" path (single org).
 */
async function syncOneOrg(deps: Deps, orgId: string): Promise<OrgSyncResult | null> {
  const admin = deps.admin;
  const [baseId, tableName, fieldMap, viewRaw] = await Promise.all([
    resolveOrgSetting<string | null>(admin, orgId, "airtable_base_id", null),
    resolveOrgSetting<string | null>(admin, orgId, "airtable_table_name", null),
    resolveOrgSetting<FieldMap>(admin, orgId, "airtable_field_map", {}),
    resolveOrgSetting<string | null>(admin, orgId, "airtable_view", "Grid view"),
  ]);
  const viewName = (viewRaw ?? "Grid view").trim();

  const logMisconfig = (detail: string) =>
    admin.from("airtable_sync_log").insert({ org_id: orgId, sync_type: "airtable_poll", status: "error", records_processed: 0, imported_count: 0, new_count: 0, updated_count: 0, held_count: 0, error_details: detail, synced_at: deps.now().toISOString() });

  if (!baseId || !tableName) { await logMisconfig("Airtable sync enabled but base_id or table_name is not configured"); return null; }
  if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) { await logMisconfig("airtable_base_id has unexpected format; expected app + 14 alphanumeric chars"); return null; }
  if (!fieldMap?.date || !fieldMap?.sub_program) { await logMisconfig("Airtable field map incomplete: 'date' and 'sub_program' must be mapped"); return null; }

  const { data: apiKey } = await admin.rpc("get_org_airtable_key", { _org: orgId });
  if (!apiKey) { await logMisconfig("Airtable sync enabled but no API key is configured in the Vault"); return null; }

  return await syncOrg(deps, orgId, baseId, tableName, apiKey as string, fieldMap, viewName);
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
 * Auth: TWO paths. (1) X-Cron-Secret header → the cross-org fan-out over EVERY active
 * org (gated per-org by airtable_poll_interval_minutes). (2) An org-admin (or a producer
 * with producer_can_trigger_sync on) JWT + { org_id } body → a manual "Sync now" for that
 * ONE org only (requireOrgRole, interval gate bypassed). The fan-out is never reachable
 * via a JWT, so a single org's admin/producer can't drive cross-org writes.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;

  // Manual "Sync now": a request WITHOUT the cron secret is an org-admin trigger for a
  // SINGLE org (never the cross-org fan-out). requireOrgRole scopes it to the caller's own
  // org, so it can't drive other orgs' writes — that's why the fan-out stays
  // cron-secret-only below. The gate is intentionally bypassed (explicit user action).
  if (req.headers.get("X-Cron-Secret") == null) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    let body: { org_id?: string } = {};
    try { body = await req.json(); } catch { /* empty/invalid body → handled below */ }
    const orgId = body?.org_id;
    if (!orgId) return json({ error: "org_id required" }, 400);
    // Admins bypass the capability gate outright; a producer additionally needs
    // producer_can_trigger_sync on for this org.
    const adminCheck = await requireOrgRole(deps, req, orgId, ["admin"]);
    if (!adminCheck.ok) {
      const producerCheck = await requireOrgRole(deps, req, orgId, ["producer"]);
      if (!producerCheck.ok) return producerCheck.response;
      const capGate = await requireCapability(deps, orgId, "producer_can_trigger_sync");
      if (capGate) return capGate;
    }
    try {
      const result = await syncOneOrg(deps, orgId);
      return json({ ok: true, orgs_synced: result ? 1 : 0, result });
    } catch (e) {
      console.error("airtable-poll: manual sync failed", { org: orgId, error: (e as { body?: unknown })?.body ?? (e as Error).message });
      return json({ error: "sync failed", org_id: orgId }, 502);
    }
  }

  // Auth: X-Cron-Secret ONLY (pg_cron, Vault-backed via get_cron_secret). No role fallback —
  // this handler syncs/writes every active org, so an org-scoped admin JWT must never trigger it.
  const auth = await requireCronSecret(deps, req);
  if (!auth.ok) return auth.response;

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

      // Per-org interval gate: skip until this org's interval has elapsed since its last
      // poll. The master cron ticks every 5 min; this throttles each org independently.
      const intervalRaw = await resolveOrgSetting<number>(admin, org.id, "airtable_poll_interval_minutes", MIN_POLL_INTERVAL_MINUTES);
      const intervalMs = clampIntervalMinutes(intervalRaw) * 60_000;
      const lastPollAt = await fetchLastPollAt(admin, org.id);
      if (lastPollAt && deps.now().getTime() - lastPollAt.getTime() < intervalMs - POLL_GRACE_MS) continue;

      const r = await syncOneOrg(deps, org.id);
      if (!r) continue; // misconfigured — error row already written

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
