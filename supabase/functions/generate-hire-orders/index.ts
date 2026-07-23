// generate-hire-orders — the hire-order engine. Seven per-request actions:
//   draft            create draft orders from confirmed bookings (snapshot fields)
//   draft-manual     create ONE draft from the V5 wizard: free choice of artist x
//                    date (either/both optional) plus producer-entered manual fields
//   issue            validate -> render PDF -> upload -> stamp issued -> email + notify
//                    (+ a Documenso countersign envelope when the org is in that mode)
//   preview          render a watermarked PDF for one order, persist nothing
//   download-url     signed URL for an order's PDF (producers + the linked artist)
//   countersign-test admin-only Documenso connectivity check for the settings card
//   sign             the linked artist signs an issued electronic order: re-render PDF
//                    + certificate, store signed_pdf_path + a hire_order_signatures
//                    audit row, flip to countersigned, notify + email
//
// DI: exports handle(req, deps); Deno.serve wiring at the bottom. Tests inject
// makeFakeDeps (deps.renderHireOrderPdf is stubbed). See index.di.test.ts.
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole, requireOrgRole } from "../_shared/auth.ts";
import type { TablesInsert, TablesUpdate } from "../_shared/database.types.ts";
import type { OrgAdminRow, ProducerAssignmentRow, ResolveShowAssignmentsArgs } from "../_shared/rows.ts";
import { requireFeature } from "../_shared/entitlements.ts";
import { resolveOrgSetting } from "../_shared/settings.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { APP_URL } from "../_shared/app-url.ts";
import { createAndSendEnvelope, documensoAuthHeader } from "../_shared/documenso.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  formatMoney,
  formatOrderNo,
  orderReadyIssues,
  resolveFields,
  withCollisionSuffix,
  type FieldLayers,
  type HireOrderLetterhead,
  type HireOrderTerm,
  type OrderData,
  type OrderFieldKey,
  type RenderSignature,
} from "../_shared/hireOrders.ts";

// ── settings shapes + fallbacks (mirror src/components/settings/hireOrders/*) ──

interface Numbering { prefix: string; pattern: string }
interface OrderDefaults { default_fee: number | null; currency: string }
interface TermsVariants { lean: HireOrderTerm[]; standard: HireOrderTerm[]; full: HireOrderTerm[] }
type TermsVariant = keyof TermsVariants;
interface Countersign {
  // 'documenso' is retained for the dormant Documenso path (see issueOne + _shared/documenso.ts).
  mode: "manual" | "documenso" | "electronic";
  /** electronic mode only: also email producers the signed PDF on countersign. */
  email_producers_on_countersign?: boolean;
}

/**
 * The letterhead + terms + currency resolved at issue time, frozen into
 * hire_orders.issue_snapshot so the countersigned re-render (signOrder) reproduces
 * the exact document the issued hash attests to. The snapshot letterhead already
 * bakes in the per-order agent override that issueOne merges, so the sign path must
 * NOT re-apply agent overrides on top of it. Null for orders issued before the
 * column existed (signOrder falls back to live resolution for those).
 *
 * `countersign_mode` freezes the countersign mode the order was ISSUED under, so
 * the electronic-vs-manual signing gate follows the issue-time mode and cannot be
 * flipped by a later org-setting change (the DB transition gate, signOrder, and
 * the frontend all key off this). Legacy/null snapshots fall back to the live setting.
 */
interface IssueSnapshot { letterhead: HireOrderLetterhead; terms: HireOrderTerm[]; currency: string; countersign_mode: string }

const NUMBERING_DEFAULT: Numbering = { prefix: "HO", pattern: "{prefix}-{yyyy}-{mmdd}-{seq}" };
const DEFAULTS_DEFAULT: OrderDefaults = { default_fee: null, currency: "EUR" };
const LETTERHEAD_DEFAULT: HireOrderLetterhead = { legal_name: "", address_lines: [] };
const TERMS_DEFAULT: TermsVariants = { lean: [], standard: [], full: [] };
const COUNTERSIGN_DEFAULT: Countersign = { mode: "manual" };

const BUCKET = "hire-orders";
const SIGNED_URL_TTL = 3600;
const DOCUMENSO_DEFAULT_BASE_URL = "https://app.documenso.com";

/**
 * The Documenso instance origin is OPERATOR-controlled ONLY (edge secret
 * DOCUMENSO_BASE_URL), never a per-org setting or request body. DOCUMENSO_API_TOKEN
 * is a single instance-wide secret shared by every org, so letting an org's free-text
 * setting (or a request body field) steer where it's sent would let an admin in org A
 * point it at an attacker host and exfiltrate the shared token plus the rendered
 * hire-order PDF (artist PII) for every org (SSRF / cross-tenant secret exfiltration).
 * Defaults to the hosted app.documenso.com. Rejects a non-https value outright — never
 * silently falls back — since the shared token travels in this request's Authorization
 * header.
 */
function resolveDocumensoBaseUrl(deps: Deps): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const raw = deps.env("DOCUMENSO_BASE_URL");
  const baseUrl = raw && raw.trim() !== "" ? raw : DOCUMENSO_DEFAULT_BASE_URL;
  if (!baseUrl.startsWith("https://")) return { ok: false, error: "documenso_base_url_invalid" };
  return { ok: true, baseUrl };
}

// ── row shapes (mirror the select strings at the call sites — if you change a
//    select, change its interface in the same commit) ───────────────────────

interface ShowProgramJoin {
  program: string | null;
  sub_program: string | null;
}

/** Shape of draftOrders' show_dates select. */
interface ShowDateRow {
  id: string;
  org_id: string;
  show_id: string;
  city_id: string | null;
  date: string;
  venue: string | null;
  duration_minutes: number | null;
  notes: string | null;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  shows: ShowProgramJoin | null;
}

interface BookingArtistJoin {
  id: string;
  name: string | null;
  email: string | null;
  cast_role: string | null;
  user_id: string | null;
}

/** Shape of draftOrders' bookings select. */
interface BookingWithArtistRow {
  id: string;
  artist_id: string;
  fee_amount: number | null;
  status: string;
  artists: BookingArtistJoin | null;
}

/** Shape of draftManual's artists select. */
interface ManualArtistRow {
  id: string;
  name: string | null;
  email: string | null;
  cast_role: string | null;
}

/** Shape of draftManual's show_dates select. */
interface ManualShowDateRow {
  id: string;
  date: string;
  venue: string | null;
  city_id: string | null;
  duration_minutes: number | null;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  shows: ShowProgramJoin | null;
}

/** Shape of issueOne's hire_orders select (also what sendIssuedEmail/notifyArtist receive). */
interface IssueOrderRow {
  id: string;
  org_id: string;
  order_no: string;
  status: string;
  data: OrderData;
  terms_variant: string | null;
  fee_currency: string | null;
  artist_id: string | null;
  agent_name: string | null;
  agent_email: string | null;
}

/** Shape of previewOrder's hire_orders select. */
interface PreviewOrderRow {
  id: string;
  org_id: string;
  order_no: string;
  data: OrderData;
  terms_variant: string | null;
  fee_currency: string | null;
  agent_name: string | null;
  agent_email: string | null;
}

/** Shape of downloadUrl's hire_orders select. */
interface DownloadOrderRow {
  id: string;
  org_id: string;
  artist_id: string | null;
  status: string;
  pdf_path: string | null;
  signed_pdf_path: string | null;
  order_no: string;
}

// ── entry ──────────────────────────────────────────────────────────────────

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.org_id) return json({ error: "bad_request" }, 400);

  // download-url authorizes artists for their own issued orders, so it CANNOT sit
  // behind the admin/producer gate — it runs its own auth (see downloadUrl).
  if (body.action === "download-url") return downloadUrl(deps, req, body);

  // sign authorizes the linked ARTIST (who holds neither admin nor producer), so
  // it likewise sits BEFORE the admin/producer gate and runs its own auth
  // (see signOrder — Bearer JWT -> the order's linked artist only).
  if (body.action === "sign") return signOrder(deps, req, body);

  // Org-scoped gate for draft/issue/preview. A cron-secret caller (the trigger /
  // Task-9 cron) is org-agnostic and validated by the shared secret. A JWT caller
  // must hold admin/producer WITHIN the TARGET org (body.org_id) — NOT merely in
  // some org: requireCronOrRole's JWT fallback (requireRole) checks the role in ANY
  // org, which combined with the RLS-bypassing admin client would let an admin of
  // org A act on org B (cross-tenant). requireOrgRole closes that (and accepts
  // super-admins). Mirrors open-offer-tier's coarse-then-org-scoped pattern.
  const isCron = !!req.headers.get("X-Cron-Secret");
  const gate = isCron
    ? await requireCronOrRole(deps, req, ["admin", "producer"])
    : await requireOrgRole(deps, req, body.org_id, ["admin", "producer"]);
  if (!gate.ok) return gate.response;

  const denied = await requireFeature(deps, body.org_id, "hire_orders");
  if (denied) return denied;

  switch (body.action) {
    case "draft":
      return draftOrders(deps, body, gate.userId);
    case "draft-manual":
      return draftManual(deps, body, gate.userId);
    case "issue":
      return issueOrders(deps, body, gate.userId);
    case "preview":
      return previewOrder(deps, body);
    case "countersign-test": {
      // NOT IN USE: dormant Documenso path, no org can select 'documenso' since the
      // settings UI offers only manual|electronic. Retained for a future self-hosted Documenso.
      // The coarse gate above accepts admin OR producer; this action is admin-only
      // (mirrors airtable-schema's admin-only connectivity check), so re-check.
      const adminGate = await requireOrgRole(deps, req, body.org_id, ["admin"]);
      if (!adminGate.ok) return adminGate.response;
      return countersignTest(deps);
    }
    default:
      return json({ error: "unknown_action" }, 400);
  }
}

// ── draft ────────────────────────────────────────────────────────────────

interface DraftBody { org_id: string; show_date_id: string; booking_ids?: string[]; notify?: boolean }

async function draftOrders(deps: Deps, body: DraftBody, userId: string | null): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  if (!body.show_date_id) return json({ error: "show_date_id required" }, 400);

  // Show date (org-scoped) with its show, for the snapshot + order-number cast code.
  const { data: sd } = await admin
    .from("show_dates")
    .select("id, org_id, show_id, city_id, date, venue, duration_minutes, notes, session_1, session_2, session_3, shows(program, sub_program)")
    .eq("id", body.show_date_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!sd) return json({ error: "show_date_not_found" }, 404);
  const showDate = sd as unknown as ShowDateRow;

  // Confirmed bookings for the date (optionally a subset), artist joined.
  let bq = admin
    .from("bookings")
    .select("id, artist_id, fee_amount, status, artists(id, name, email, cast_role, user_id)")
    .eq("show_date_id", body.show_date_id)
    .eq("status", "confirmed");
  if (Array.isArray(body.booking_ids) && body.booking_ids.length > 0) bq = bq.in("id", body.booking_ids);
  const { data: bookingRows, error: bErr } = await bq;
  if (bErr) return json({ error: bErr.message }, 500);
  const bookings = (bookingRows ?? []) as unknown as BookingWithArtistRow[];

  const created: string[] = [];
  const skipped: Array<{ booking_id: string; reason: string }> = [];
  if (bookings.length === 0) return json({ created, skipped });

  // Bookings that already hold a non-void order are skipped (mirrors the partial-unique
  // active-booking index — one live order per booking).
  const bookingIds = bookings.map((b) => b.id);
  const { data: existing } = await admin
    .from("hire_orders").select("booking_id").in("booking_id", bookingIds).neq("status", "void");
  const hasOrder = new Set(((existing ?? []) as unknown as { booking_id: string }[]).map((r) => r.booking_id));

  // Settings for the snapshot + numbering.
  const [defaults, numbering] = await Promise.all([
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
    resolveOrgSetting<Numbering>(admin, org, "hire_order_numbering", NUMBERING_DEFAULT),
  ]);

  // City name (showflow field).
  let cityName: string | null = null;
  if (showDate.city_id) {
    const { data: c } = await admin.from("cities").select("name").eq("id", showDate.city_id).maybeSingle();
    cityName = (c as { name?: string } | null)?.name ?? null;
  }

  // Sequence base: existing non-void orders for this org across the WHOLE calendar
  // day (not just this show_date). Scoping to the day — via an inner-join on the
  // order's show_date — keeps {seq} unique when an org runs several show_dates on
  // the same date, so `HO-{yyyy}-{mmdd}-{seq}` never repeats a base across them and
  // the collision suffix stays a genuine safety net rather than a differentiator.
  // Concurrency is still guarded by the (org_id, order_no) unique index + suffix
  // retry: two simultaneous drafts may read the same base, but the index rejects a
  // duplicate and insertWithRetry advances the suffix.
  const { count } = await admin
    .from("hire_orders")
    .select("id, show_dates!inner(date)", { count: "exact", head: true })
    .eq("org_id", org).eq("show_dates.date", showDate.date).neq("status", "void");
  let seq = count ?? 0;

  const castCode = castCodeFromLabel(showDate.shows?.program ?? null);
  const sessions = [showDate.session_1, showDate.session_2, showDate.session_3].filter(
    (t: unknown): t is string => typeof t === "string" && t !== "",
  );

  for (const b of bookings) {
    // Per-booking isolation (mirrors issueOrders): an unexpected throw on one
    // booking must not abort the batch into a CORS-less 500.
    try {
      if (hasOrder.has(b.id)) {
        skipped.push({ booking_id: b.id, reason: "exists" });
        continue;
      }
      const artist: Partial<BookingArtistJoin> = b.artists ?? {};

      // showflow layer: only non-empty values (resolveFields treats undefined/"" as
      // absent, but NOT null — so nulls are omitted here rather than mis-tagged).
      const showflow: Partial<Record<OrderFieldKey, unknown>> = {};
      assign(showflow, "artist_name", artist.name);
      assign(showflow, "recipient_email", artist.email);
      assign(showflow, "role", artist.cast_role);
      assign(showflow, "date", showDate.date);
      assign(showflow, "venue", showDate.venue);
      assign(showflow, "city", cityName);
      assign(showflow, "duration_min", showDate.duration_minutes);
      if (sessions.length > 0) showflow.sessions = sessions;
      assign(showflow, "fee", b.fee_amount);

      // defaults layer: org default fee (fallback under a booking fee) + currency.
      const defLayer: Partial<Record<OrderFieldKey, unknown>> = { currency: defaults.currency };
      assign(defLayer, "fee", defaults.default_fee);

      const layers: FieldLayers = { showflow, defaults: defLayer };
      const data = resolveFields(layers);

      seq += 1;
      const baseOrderNo = formatOrderNo(numbering.pattern, {
        prefix: numbering.prefix,
        date: showDate.date,
        castCode,
        seq,
      });

      const feeValue = data.fee?.value;
      const feeAmount = feeValue === undefined || feeValue === null || feeValue === "" ? null : Number(feeValue);
      const row = {
        org_id: org,
        status: "draft" as const,
        booking_id: b.id,
        artist_id: b.artist_id,
        show_date_id: body.show_date_id,
        data,
        fee_amount: feeAmount,
        fee_currency: defaults.currency,
        terms_variant: "standard",
        created_by: userId,
      };

      const result = await insertWithRetry(admin, baseOrderNo, row);
      if ("id" in result) created.push(result.id);
      else skipped.push({ booking_id: b.id, reason: result.reason });
    } catch (e) {
      console.error("generate-hire-orders: draft failed for booking", { org, bookingId: b.id, error: (e as Error).message });
      skipped.push({ booking_id: b.id, reason: "error" });
    }
  }

  // Optional producer notification (mirrors booking_ready_to_confirm recipient
  // resolution): once per recipient for the batch, only if anything was created.
  if (body.notify && created.length > 0) {
    await notifyProducers(deps, org, showDate, created.length);
  }

  return json({ created, skipped });
}

/**
 * Insert with unique-violation retry using the shared collision suffix.
 * The base order number is already unique per artist per day (see the {seq}
 * scope above), so a collision here means a genuine race; the cap is a
 * defense-in-depth safety net, not the primary differentiator.
 *
 * TWO distinct unique constraints can raise 23505 on this insert:
 *   hire_orders_org_id_order_no_key (order_no collision) -> keep retrying
 *     the suffix, as always.
 *   hire_orders_active_artist_date_uniq (one active order per (org, artist,
 *     show_date), mirrors bookings_active_artist_date_uniq) -> NOT retriable
 *     by suffix -- a different order_no can never resolve an artist/date
 *     conflict -- so it is reported as a distinct 'exists' reason instead of
 *     being folded into order_no_collision after burning 20 attempts.
 */
async function insertWithRetry(
  admin: Deps["admin"],
  baseOrderNo: string,
  row: Record<string, unknown>,
): Promise<{ id: string } | { reason: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const order_no = withCollisionSuffix(baseOrderNo, attempt);
    const { data, error } = await admin
      // row is a dynamically-assembled draft (resolveFields output), so it is a
      // Record — single cast to the table's Insert type at the boundary.
      .from("hire_orders").insert({ ...row, order_no } as unknown as TablesInsert<"hire_orders">).select("id").maybeSingle();
    if (!error && data) return { id: (data as { id: string }).id };
    if (error && (error as { code?: string }).code === "23505") {
      if (isActiveArtistDateConflict(error)) return { reason: "exists" };
      continue; // order_no collision -> next suffix
    }
    if (error) return { reason: (error as { message?: string }).message ?? "insert_failed" };
  }
  return { reason: "order_no_collision" };
}

/**
 * Detect the active-artist-date backstop index from a Postgres/PostgREST
 * unique_violation error. supabase-js's PostgrestError surfaces the underlying
 * pg error's `message` (and `details`) verbatim -- e.g. `duplicate key value
 * violates unique constraint "hire_orders_active_artist_date_uniq"` -- there is
 * no separate structured constraint-name field on the client error type, so
 * matching the index name as a substring of message/details is the reliable
 * discriminator available here (confirmed live against the applied index).
 */
function isActiveArtistDateConflict(error: unknown): boolean {
  const e = error as { message?: string; details?: string } | null;
  const haystack = `${e?.message ?? ""} ${e?.details ?? ""}`;
  return haystack.includes("hire_orders_active_artist_date_uniq");
}

async function notifyProducers(deps: Deps, org: string, showDate: ShowDateRow, orderCount: number): Promise<void> {
  const admin = deps.admin;
  const { data: producers } = await admin.rpc("resolve_show_assignments", {
    p_program: showDate.shows?.program ?? "",
    p_sub_program: showDate.shows?.sub_program ?? null,
    p_city_id: showDate.city_id,
    p_org: org,
    // The SQL function accepts NULL sub_program/city_id; type-gen doesn't model that.
  } as ResolveShowAssignmentsArgs);
  let recipientIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id);
  if (recipientIds.length === 0) {
    // Fallback: notify this org's admins.
    const { data: admins } = await admin.from("org_memberships").select("user_id").eq("org_id", org).eq("role", "admin");
    recipientIds = ((admins ?? []) as unknown as OrgAdminRow[]).map((a) => a.user_id);
  }
  recipientIds = [...new Set(recipientIds)] as string[];
  if (recipientIds.length === 0) return;

  const rows = recipientIds.map((uid: string) => ({
    org_id: org,
    user_id: uid,
    type: "hire_orders_ready",
    title: "Hire orders ready",
    message: `${orderCount} hire ${orderCount === 1 ? "order is" : "orders are"} drafted and ready to review.`,
    related_entity_type: "show_date",
    related_entity_id: showDate.id,
  }));
  const { error } = await admin.from("notifications").insert(rows);
  if (error) console.error("generate-hire-orders: producer notification insert failed", { org, error: error.message });
}

// ── draft-manual ─────────────────────────────────────────────────────────

interface DraftManualBody {
  org_id: string;
  artist_id?: string;
  show_date_id?: string;
  manual?: Partial<Record<OrderFieldKey, unknown>>;
}

/**
 * The V5 wizard's single-order draft path: free choice of artist x date (either,
 * both, or neither), plus producer-entered manual fields. Unlike `draftOrders`
 * this never links a booking (a manual/wizard order has none) and creates
 * exactly one row per call.
 *
 * showflow is assembled ONLY when both artist_id and show_date_id are given
 * (mirrors draftOrders' snapshot assembly for the linked artist + show date);
 * otherwise it stays empty and every resolved field falls through to
 * manual/default. The ready gate (recipient_email etc.) is NOT applied here —
 * it only runs at issue time, so a draft can be saved with gaps.
 */
async function draftManual(deps: Deps, body: DraftManualBody, userId: string | null): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  const manual = body.manual ?? {};

  // A manual fee is producer-typed free text (V5 wizard step 2). `Number(feeValue)`
  // on a non-numeric value yields NaN, which JSON-serializes to `null` on insert —
  // silently dropping the entered value instead of rejecting the bad input. Reject
  // outright when a fee WAS provided but isn't a finite number; a genuinely absent
  // fee (undefined/null/"") keeps falling through to the existing null behavior.
  const manualFeeRaw = manual.fee;
  const manualFeeProvided = manualFeeRaw !== undefined && manualFeeRaw !== null && manualFeeRaw !== "";
  if (manualFeeProvided && !Number.isFinite(Number(manualFeeRaw))) {
    return json({ error: "invalid_fee" }, 400);
  }

  const [defaults, numbering] = await Promise.all([
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
    resolveOrgSetting<Numbering>(admin, org, "hire_order_numbering", NUMBERING_DEFAULT),
  ]);

  const showflow: Partial<Record<OrderFieldKey, unknown>> = {};
  let castCode: string | undefined;
  let numberingDate: string | undefined;

  if (body.artist_id && body.show_date_id) {
    const [{ data: artistRow }, { data: sdRow }] = await Promise.all([
      admin.from("artists").select("id, name, email, cast_role").eq("id", body.artist_id).eq("org_id", org).maybeSingle(),
      admin.from("show_dates")
        .select("id, date, venue, city_id, duration_minutes, session_1, session_2, session_3, shows(program, sub_program)")
        .eq("id", body.show_date_id).eq("org_id", org).maybeSingle(),
    ]);

    if (artistRow) {
      const artist = artistRow as unknown as ManualArtistRow;
      assign(showflow, "artist_name", artist.name);
      assign(showflow, "recipient_email", artist.email);
      assign(showflow, "role", artist.cast_role);
    }
    if (sdRow) {
      const sd = sdRow as unknown as ManualShowDateRow;
      assign(showflow, "date", sd.date);
      assign(showflow, "venue", sd.venue);
      assign(showflow, "duration_min", sd.duration_minutes);
      const sessions = [sd.session_1, sd.session_2, sd.session_3].filter(
        (t: unknown): t is string => typeof t === "string" && t !== "",
      );
      if (sessions.length > 0) showflow.sessions = sessions;
      if (sd.city_id) {
        const { data: c } = await admin.from("cities").select("name").eq("id", sd.city_id).maybeSingle();
        assign(showflow, "city", (c as { name?: string } | null)?.name ?? null);
      }
      castCode = castCodeFromLabel(sd.shows?.program ?? null);
      numberingDate = sd.date;
    }
  }

  const defLayer: Partial<Record<OrderFieldKey, unknown>> = { currency: defaults.currency };
  assign(defLayer, "fee", defaults.default_fee);

  const layers: FieldLayers = { showflow, manual, defaults: defLayer };
  const data = resolveFields(layers);

  if (!numberingDate && typeof manual.date === "string" && manual.date) numberingDate = manual.date;

  // Sequence base: a simple org-wide non-void count. draftOrders scopes its
  // sequence per calendar day via a join through the linked show_date, but a
  // wizard order may have none to join on — an org-wide count is always
  // available and, combined with insertWithRetry's collision-suffix retry, is
  // still a correct (if less tightly differentiated) base.
  const { count } = await admin.from("hire_orders").select("id", { count: "exact", head: true }).eq("org_id", org).neq("status", "void");
  const seq = (count ?? 0) + 1;

  const baseOrderNo = formatOrderNo(numbering.pattern, { prefix: numbering.prefix, date: numberingDate, castCode, seq });

  const feeValue = data.fee?.value;
  const feeAmount = feeValue === undefined || feeValue === null || feeValue === "" ? null : Number(feeValue);
  // fee_currency follows the RESOLVED currency (which a producer can override at
  // step 2), not blindly the org default — draftOrders can hardcode the org
  // default because a booking never carries its own currency; a wizard order can.
  const currencyValue = data.currency?.value;
  const currency = typeof currencyValue === "string" && currencyValue ? currencyValue : defaults.currency;

  const row = {
    org_id: org,
    status: "draft" as const,
    booking_id: null,
    artist_id: body.artist_id ?? null,
    show_date_id: body.show_date_id ?? null,
    data,
    fee_amount: feeAmount,
    fee_currency: currency,
    terms_variant: "standard",
    created_by: userId,
  };

  const result = await insertWithRetry(admin, baseOrderNo, row);
  if ("id" in result) return json({ created: [result.id] });
  // An artist/date duplicate (hire_orders_active_artist_date_uniq) is a legitimate
  // skip, not an error -- the wizard already has an active order for this exact
  // artist x date pair. Report it the same shape a batch import does, rather than
  // as a generic error (and, upstream in insertWithRetry, without a 20-attempt
  // suffix retry that could never resolve it).
  if (result.reason === "exists") return json({ created: [], skipped: [{ reason: "exists" }] });
  return json({ created: [], error: result.reason });
}

// ── issue ────────────────────────────────────────────────────────────────

interface IssueBody { org_id: string; order_ids: string[] }

async function issueOrders(deps: Deps, body: IssueBody, _userId: string | null): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  const orderIds = Array.isArray(body.order_ids) ? body.order_ids : [];
  if (orderIds.length === 0) return json({ error: "order_ids required" }, 400);

  const [letterhead, terms, defaults, countersign] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(admin, org, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    resolveOrgSetting<TermsVariants>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
    resolveOrgSetting<Countersign>(admin, org, "hire_order_countersign", COUNTERSIGN_DEFAULT),
  ]);

  const issued: string[] = [];
  const failed: Array<{ order_id: string; issues: string[] }> = [];

  for (const orderId of orderIds) {
    try {
      const outcome = await issueOne(deps, org, orderId, letterhead, terms, defaults, countersign);
      if (outcome.ok) {
        issued.push(orderId);
        // A Documenso delivery failure is a WARNING, not an issue failure: the
        // document is genuinely issued (rendered, uploaded, stamped), so it stays
        // in `issued`, and the countersign-delivery problem surfaces alongside it
        // in `failed` rather than silently disappearing.
        if (outcome.warning) failed.push({ order_id: orderId, issues: [outcome.warning] });
      } else {
        failed.push({ order_id: orderId, issues: outcome.issues });
      }
    } catch (e) {
      // Per-order capture: one bad order must not fail the batch.
      console.error("generate-hire-orders: issue failed", { org, orderId, error: (e as Error).message });
      failed.push({ order_id: orderId, issues: ["render_failed"] });
    }
  }

  return json({ issued, failed });
}

async function issueOne(
  deps: Deps,
  org: string,
  orderId: string,
  letterhead: HireOrderLetterhead,
  terms: TermsVariants,
  defaults: OrderDefaults,
  countersign: Countersign,
): Promise<{ ok: true; warning?: string } | { ok: false; issues: string[] }> {
  const admin = deps.admin;

  const { data: order } = await admin
    .from("hire_orders")
    .select("id, org_id, order_no, status, data, terms_variant, fee_currency, artist_id, agent_name, agent_email")
    .eq("id", orderId)
    .eq("org_id", org)
    .maybeSingle();
  if (!order) return { ok: false, issues: ["not_found"] };
  const o = order as unknown as IssueOrderRow;

  // Idempotency: an already-issued (or countersigned) order is frozen.
  if (o.status === "issued" || o.status === "countersigned") return { ok: false, issues: ["already_issued"] };
  if (o.status === "void") return { ok: false, issues: ["voided"] };

  const data = o.data as OrderData;
  const variant = (o.terms_variant as TermsVariant) ?? "standard";
  const variantTerms = terms[variant] ?? [];

  // Readiness gate (four frozen codes) + the terms gate (org must have authored
  // clauses for this variant before it can issue).
  const issues = orderReadyIssues(data, letterhead);
  if (variantTerms.length === 0) issues.push("missing_terms");
  if (issues.length > 0) return { ok: false, issues };

  // Promote a draft to ready before issuing (the transition machine forbids
  // draft -> issued directly). A ready order is issued straight through.
  if (o.status === "draft") {
    const { error } = await admin.from("hire_orders").update({ status: "ready" }).eq("id", orderId);
    if (error) return { ok: false, issues: ["transition_failed"] };
  }

  const effectiveLetterhead: HireOrderLetterhead = {
    ...letterhead,
    agent_name: o.agent_name ?? letterhead.agent_name,
    agent_email: o.agent_email ?? letterhead.agent_email,
  };
  const currency = o.fee_currency ?? defaults.currency ?? "EUR";
  const bytes = await deps.renderHireOrderPdf({
    data,
    orderNo: o.order_no,
    status: "issued",
    letterhead: effectiveLetterhead,
    terms: variantTerms,
    currency,
    generatedAtIso: deps.now().toISOString(),
  });

  const path = `${org}/${o.order_no}.pdf`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) return { ok: false, issues: ["upload_failed"] };

  const issuedPdfSha256 = await sha256Hex(bytes);
  // Freeze the resolved letterhead/terms/currency alongside the issued stamp so the
  // signed re-render reproduces this exact document (finding W1). This write is the
  // ready->issued transition, which the freeze trigger permits.
  const snapshot: IssueSnapshot = { letterhead: effectiveLetterhead, terms: variantTerms, currency, countersign_mode: countersign.mode };
  const { error: issueErr } = await admin
    .from("hire_orders")
    .update({
      status: "issued",
      issued_at: deps.now().toISOString(),
      pdf_path: path,
      issued_pdf_sha256: issuedPdfSha256,
      issue_snapshot: snapshot,
    } as unknown as TablesUpdate<"hire_orders">)
    .eq("id", orderId);
  if (issueErr) return { ok: false, issues: ["transition_failed"] };

  // Documenso countersignature (design spec §8): send the SAME rendered bytes
  // to Documenso for e-signature. FAILURE CONTAINMENT is the point of this
  // block — the document is already issued (rendered, uploaded, stamped) above,
  // and nothing here may undo that. A Documenso error (missing token, network,
  // non-2xx) falls back to manual countersign mode and surfaces as a `warning`
  // the caller reports alongside the (still-successful) issue, never as an
  // issue failure.
  let countersignModeUsed = countersign.mode ?? "manual";
  let signingUrl: string | null = null;
  let warning: string | undefined;

  // NOT IN USE: dormant Documenso path, no org can select 'documenso' since the
  // settings UI offers only manual|electronic. Retained for a future self-hosted Documenso.
  if (countersignModeUsed === "documenso") {
    const token = deps.env("DOCUMENSO_API_TOKEN");
    const baseUrlResult = resolveDocumensoBaseUrl(deps);
    try {
      if (!token) throw new Error("documenso_token_missing");
      if (!baseUrlResult.ok) throw new Error(baseUrlResult.error);
      const recipientEmail = strField(data, "recipient_email");
      const recipientName = strField(data, "artist_name") || recipientEmail;
      const envelope = await createAndSendEnvelope(
        deps.fetch,
        { baseUrl: baseUrlResult.baseUrl, token },
        { title: o.order_no, pdf: bytes, recipientName, recipientEmail },
      );
      signingUrl = envelope.signingUrl;
      const { error: csErr } = await admin
        .from("hire_orders")
        .update({ countersign_mode: "documenso", documenso_envelope_id: envelope.envelopeId })
        .eq("id", orderId);
      if (csErr) {
        console.error("generate-hire-orders: countersign_mode stamp failed", { org, orderId, error: csErr.message });
      }
    } catch (e) {
      console.error("generate-hire-orders: documenso envelope failed", { org, orderId, error: (e as Error).message });
      countersignModeUsed = "manual";
      warning = "documenso_failed";
      // Explicit fallback write: the order's countersign_mode must read 'manual'
      // even though nothing was ever stamped 'documenso' for it (issue only runs
      // once per order — the already-issued gate above blocks a retry).
      const { error: fallbackErr } = await admin
        .from("hire_orders").update({ countersign_mode: "manual" }).eq("id", orderId);
      if (fallbackErr) {
        console.error("generate-hire-orders: countersign fallback stamp failed", { org, orderId, error: fallbackErr.message });
      }
    }
  }

  // Electronic (in-app) countersign: nothing to send at issue time — the artist
  // signs later on the order page. Point the issued email's "Review and sign" CTA
  // at that page (the auth-gated detail route, keyed by the order UUID).
  if (countersignModeUsed === "electronic") {
    signingUrl = `${APP_URL}/hire-orders/${o.id}`;
  }

  // Best-effort side effects — a failure here must NOT undo a successful issue.
  await sendIssuedEmail(deps, org, o, data, bytes, currency, countersignModeUsed, signingUrl).catch((e) =>
    console.error("generate-hire-orders: issued email failed", { org, orderId, error: (e as Error).message }),
  );
  await notifyArtist(deps, org, o).catch((e) =>
    console.error("generate-hire-orders: artist notification failed", { org, orderId, error: (e as Error).message }),
  );

  return warning ? { ok: true, warning } : { ok: true };
}

async function sendIssuedEmail(
  deps: Deps,
  org: string,
  order: IssueOrderRow,
  data: OrderData,
  bytes: Uint8Array,
  currency: string,
  countersignMode: string,
  signingUrl: string | null,
): Promise<void> {
  const recipient = strField(data, "recipient_email");
  if (!recipient) {
    console.warn("generate-hire-orders: no recipient email, skipping issued email", { org, orderId: order.id });
    return;
  }
  const feeValue = data.fee?.value;
  const feeLabel = feeValue === undefined || feeValue === null || feeValue === ""
    ? ""
    : formatMoney(feeValue as string | number, currency); // same fee/currency the PDF shows

  const result = await deps.sendEmail({
    template_name: "hire-order-issued",
    recipient_email: recipient,
    org_id: org,
    // Contract of _shared/transactional-email-templates/hire-order-issued.tsx (snake_case).
    // download_url points at the auth-gated V3 detail page (re-signs the PDF on demand),
    // NOT a raw signed storage URL — a signed URL expires in 3600s and would be dead in the
    // inbox. The route is /hire-orders/:id, so it uses order.id (the uuid), not order_no.
    // signing_url is set in documenso mode and in electronic mode (the in-app order
    // page). It is undefined, so omitted, for manual mode and for a documenso
    // attempt that failed and fell back -- see issueOne.
    templateData: {
      artist_name: strField(data, "artist_name"),
      order_no: order.order_no,
      date_label: dateLabel(strField(data, "date")),
      venue: strField(data, "venue"),
      city: strField(data, "city"),
      fee_label: feeLabel,
      download_url: `${APP_URL}/hire-orders/${order.id}`,
      countersign_mode: countersignMode,
      signing_url: signingUrl ?? undefined,
    },
    attachments: [{ filename: `${order.order_no}.pdf`, content_base64: encodeBase64(bytes) }],
    idempotency_key: `hire-order-issued-${order.id}`,
  });
  if (result.error != null) {
    console.warn("generate-hire-orders: issued email not delivered", { org, orderId: order.id, error: result.error });
  }
}

async function notifyArtist(deps: Deps, org: string, order: IssueOrderRow): Promise<void> {
  if (!order.artist_id) return;
  const admin = deps.admin;
  // Unlinked artists (no auth user) get no in-app notification.
  const { data: artist } = await admin.from("artists").select("user_id").eq("id", order.artist_id).maybeSingle();
  const userId = (artist as { user_id?: string | null } | null)?.user_id;
  if (!userId) return;
  const { error } = await admin.from("notifications").insert([{
    org_id: org,
    user_id: userId,
    type: "hire_order_issued",
    title: "Hire order issued",
    message: `Your hire order ${order.order_no} has been issued.`,
    related_entity_type: "hire_order",
    related_entity_id: order.id,
  }]);
  if (error) console.error("generate-hire-orders: artist notification insert failed", { org, orderId: order.id, error: error.message });
}

// ── preview ────────────────────────────────────────────────────────────────

interface PreviewBody { org_id: string; order_id: string }

async function previewOrder(deps: Deps, body: PreviewBody): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  const { data: order } = await admin
    .from("hire_orders")
    .select("id, org_id, order_no, data, terms_variant, fee_currency, agent_name, agent_email")
    .eq("id", body.order_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!order) return json({ error: "not_found" }, 404);
  const o = order as unknown as PreviewOrderRow;

  const [letterhead, terms, defaults] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(admin, org, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    resolveOrgSetting<TermsVariants>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
  ]);
  const variant = (o.terms_variant as TermsVariant) ?? "standard";

  const effectiveLetterhead: HireOrderLetterhead = {
    ...letterhead,
    agent_name: o.agent_name ?? letterhead.agent_name,
    agent_email: o.agent_email ?? letterhead.agent_email,
  };
  const bytes = await deps.renderHireOrderPdf({
    data: o.data as OrderData,
    orderNo: o.order_no,
    status: "preview",
    letterhead: effectiveLetterhead,
    terms: terms[variant] ?? [],
    currency: o.fee_currency ?? defaults.currency ?? "EUR",
    generatedAtIso: deps.now().toISOString(),
  });

  return json({ pdf_base64: encodeBase64(bytes) });
}

// ── download-url (own auth: producers + linked artist) ─────────────────────

interface DownloadBody { org_id: string; order_id: string }

async function downloadUrl(deps: Deps, req: Request, body: DownloadBody): Promise<Response> {
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  // Any authenticated user; authorization is decided against the loaded order below.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = deps.userClient(authHeader);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const admin = deps.admin;
  const { data: order } = await admin
    .from("hire_orders")
    .select("id, org_id, artist_id, status, pdf_path, signed_pdf_path, order_no")
    .eq("id", body.order_id)
    .eq("org_id", body.org_id)
    .maybeSingle();
  if (!order) return json({ error: "not_found" }, 404);
  const o = order as unknown as DownloadOrderRow;

  let allowed = false;

  // 1) Admin/producer of the order's org.
  const { data: roleRow } = await admin
    .from("org_memberships").select("role")
    .eq("user_id", user.id).eq("org_id", o.org_id).in("role", ["admin", "producer"]).limit(1).maybeSingle();
  if (roleRow) allowed = true;

  // 2) Super-admin (god mode).
  if (!allowed) {
    const { data: superRow } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (superRow) allowed = true;
  }

  // 3) The linked artist, on an issued/countersigned order only.
  if (!allowed && o.artist_id && (o.status === "issued" || o.status === "countersigned")) {
    const { data: artistRow } = await admin
      .from("artists").select("id").eq("id", o.artist_id).eq("user_id", user.id).maybeSingle();
    if (artistRow) allowed = true;
  }

  if (!allowed) return json({ error: "forbidden" }, 403);
  // The countersigned copy is the document of record once signed; fall back to the
  // original issued PDF for orders that were never electronically countersigned.
  const path = o.signed_pdf_path ?? o.pdf_path;
  if (!path) return json({ error: "no_pdf" }, 409);

  // Sign with the caller's client so storage RLS is the backstop.
  const { data: signed, error: signErr } = await userClient.storage
    .from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (signErr || !signed) return json({ error: "sign_failed" }, 500);

  return json({ url: (signed as { signedUrl: string }).signedUrl, expires_in: SIGNED_URL_TTL });
}

// ── sign (own auth: the linked artist only) ────────────────────────────────

interface SignBody {
  org_id: string;
  order_id: string;
  method?: "typed" | "drawn";
  typed_name?: string;
  signature_png?: string;
  consent?: boolean;
}

/** Shape of the order select in signOrder (mirrors the select string). */
interface SignOrderRow {
  id: string;
  org_id: string;
  order_no: string;
  status: string;
  artist_id: string | null;
  terms_variant: string | null;
  fee_currency: string | null;
  agent_name: string | null;
  agent_email: string | null;
  issued_pdf_sha256: string | null;
  issue_snapshot: IssueSnapshot | null;
  data: OrderData;
  show_date_id: string | null;
  show_dates: { city_id: string | null; shows: { program: string | null; sub_program: string | null } | null } | null;
}

const CONSENT_TEXT =
  "By signing, I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept the terms of this hire order.";
const MAX_SIGNATURE_PNG_CHARS = 2_000_000; // ~1.5MB decoded — a generous cap for a canvas PNG

async function signOrder(deps: Deps, req: Request, body: SignBody): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  // Own auth: any authenticated user; authorization decided against the loaded order.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await deps.userClient(authHeader).auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: orderRaw } = await admin
    .from("hire_orders")
    .select("id, org_id, order_no, status, artist_id, terms_variant, fee_currency, agent_name, agent_email, issued_pdf_sha256, issue_snapshot, data, show_date_id, show_dates(city_id, shows(program, sub_program))")
    .eq("id", body.order_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!orderRaw) return json({ error: "not_found" }, 404);
  const o = orderRaw as unknown as SignOrderRow;

  // Only the linked artist may sign.
  if (!o.artist_id) return json({ error: "forbidden" }, 403);
  const { data: artistRow } = await admin
    .from("artists").select("id").eq("id", o.artist_id).eq("user_id", user.id).maybeSingle();
  if (!artistRow) return json({ error: "forbidden" }, 403);

  // Idempotency + status guard.
  if (o.status === "countersigned") return json({ countersigned: true, idempotent: true });
  if (o.status !== "issued") return json({ error: "not_issued" }, 409);

  // Feature + mode gate.
  const denied = await requireFeature(deps, org, "hire_orders");
  if (denied) return denied;
  const countersign = await resolveOrgSetting<Countersign>(admin, org, "hire_order_countersign", COUNTERSIGN_DEFAULT);
  // Prefer the mode the order was ISSUED under (frozen in the snapshot) over the live
  // org setting, so switching the org electronic->manual mid-flight cannot strand an
  // electronic-issued order (the DB gate keys off the same frozen mode). Legacy/null
  // snapshots fall back to the current setting.
  const effectiveMode = o.issue_snapshot?.countersign_mode ?? countersign.mode;
  if (effectiveMode !== "electronic") return json({ error: "wrong_mode" }, 409);

  // Consent + payload validation.
  if (body.consent !== true) return json({ error: "consent_required" }, 400);
  const method = body.method;
  if (method !== "typed" && method !== "drawn") return json({ error: "invalid_signature" }, 400);
  const typedName = (body.typed_name ?? "").trim();
  if (method === "typed" && typedName === "") return json({ error: "invalid_signature" }, 400);
  const png = body.signature_png ?? "";
  if (method === "drawn" && (!png.startsWith("data:image/png;base64,") || png.length > MAX_SIGNATURE_PNG_CHARS)) {
    return json({ error: "invalid_signature" }, 400);
  }

  const data = o.data;
  const signerName = strField(data, "artist_name") || typedName || "Artist";
  const signerEmail = strField(data, "recipient_email") || null;
  const signedAtIso = deps.now().toISOString();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent") || null;

  // Store the drawn image (audit trail); typed signatures have no image.
  let signatureImagePath: string | null = null;
  if (method === "drawn") {
    const b64 = png.slice(png.indexOf(",") + 1);
    // The prefix + length were validated above, but the base64 BODY can still be
    // undecodable (invalid chars) -> decodeBase64 throws. handle() has no try/catch
    // around signOrder, so an escaped throw would be a CORS-less 500; treat it as
    // the same clean 400 the other payload-validation failures return.
    let pngBytes: Uint8Array;
    try {
      pngBytes = decodeBase64(b64);
    } catch {
      return json({ error: "invalid_signature" }, 400);
    }
    signatureImagePath = `${org}/signatures/${o.order_no}.png`;
    const { error: imgErr } = await admin.storage.from(BUCKET).upload(signatureImagePath, pngBytes, {
      contentType: "image/png", upsert: true,
    });
    if (imgErr) return json({ error: "signature_upload_failed" }, 500);
  }

  // Re-render the signed PDF from the frozen issue snapshot so it reproduces the
  // exact issued document the certificate hash attests to (finding W1). Legacy
  // orders issued before the issue_snapshot column carry null and fall back to
  // re-resolving the org's CURRENT letterhead/terms + the per-order agent override.
  const [letterhead, terms, defaults] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(admin, org, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    resolveOrgSetting<TermsVariants>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
  ]);
  const snapshot = o.issue_snapshot;
  let renderLetterhead: HireOrderLetterhead;
  let renderTerms: HireOrderTerm[];
  let currency: string;
  if (snapshot && snapshot.letterhead && Array.isArray(snapshot.terms)) {
    // The snapshot letterhead already includes the per-order agent override baked in
    // at issue time, so do NOT re-merge o.agent_name/agent_email here.
    renderLetterhead = snapshot.letterhead;
    renderTerms = snapshot.terms;
    currency = snapshot.currency ?? o.fee_currency ?? defaults.currency ?? "EUR";
  } else {
    const variant = (o.terms_variant as TermsVariant) ?? "standard";
    renderLetterhead = {
      ...letterhead,
      agent_name: o.agent_name ?? letterhead.agent_name,
      agent_email: o.agent_email ?? letterhead.agent_email,
    };
    renderTerms = terms[variant] ?? [];
    currency = o.fee_currency ?? defaults.currency ?? "EUR";
  }
  const signature: RenderSignature = {
    method,
    typedName: method === "typed" ? typedName : undefined,
    imageDataUrl: method === "drawn" ? png : undefined,
    signerName,
    signerEmail: signerEmail ?? undefined,
    signedAtIso,
    ip: ip ?? undefined,
    userAgent: userAgent ?? undefined,
    documentSha256: o.issued_pdf_sha256 ?? "",
    consentText: CONSENT_TEXT,
  };
  const signedBytes = await deps.renderHireOrderPdf({
    data, orderNo: o.order_no, status: "countersigned", letterhead: renderLetterhead,
    terms: renderTerms, currency, generatedAtIso: signedAtIso, signature,
  });

  // Upload the signed copy (keeps the original issued pdf_path intact).
  const signedPath = `${org}/${o.order_no}-signed.pdf`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(signedPath, signedBytes, {
    contentType: "application/pdf", upsert: true,
  });
  if (upErr) return json({ error: "signed_upload_failed" }, 500);

  // Audit row.
  const { error: sigErr } = await admin.from("hire_order_signatures").insert([{
    org_id: org,
    hire_order_id: o.id,
    signer_user_id: user.id,
    signer_name: signerName,
    signer_email: signerEmail,
    method,
    typed_name: method === "typed" ? typedName : null,
    signature_image_path: signatureImagePath,
    signed_at: signedAtIso,
    ip,
    user_agent: userAgent,
    consent_text: CONSENT_TEXT,
    document_sha256: o.issued_pdf_sha256,
    // dynamically assembled audit row -> single cast at the boundary
  }] as unknown as TablesInsert<"hire_order_signatures">[]);
  // A 23505 (unique(hire_order_id)) means an audit row ALREADY exists for this order
  // — either a concurrent winner, or a prior submit that inserted the row but whose
  // flip then failed, stranding the order at 'issued'. Do NOT blind-return success:
  // fall through to the guarded flip below (the single source of truth). It flips the
  // order if it is still 'issued' (completing that prior submit) or no-ops idempotently
  // (!affected) if a winner already flipped it. Any other error is a genuine 500.
  if (sigErr && (sigErr as { code?: string }).code !== "23505") return json({ error: "signature_insert_failed" }, 500);

  // Atomic + idempotent transition (guarded by status='issued').
  const { data: updatedRows, error: updErr } = await admin
    .from("hire_orders")
    .update({ status: "countersigned", countersigned_at: signedAtIso, signed_pdf_path: signedPath, countersign_mode: "electronic" })
    .eq("id", o.id)
    .eq("status", "issued")
    .select("id");
  if (updErr) return json({ error: "transition_failed" }, 500);
  const affected = Array.isArray(updatedRows) ? updatedRows.length > 0 : !!updatedRows;
  if (!affected) return json({ countersigned: true, idempotent: true });

  // Best-effort side effects — never undo a completed signing.
  await notifyProducersCountersigned(deps, o).catch((e) =>
    console.error("generate-hire-orders: sign producer notify failed", { org, orderId: o.id, error: (e as Error).message }));
  await notifyArtistCountersigned(deps, org, o, user.id).catch((e) =>
    console.error("generate-hire-orders: sign artist notify failed", { org, orderId: o.id, error: (e as Error).message }));
  await sendCountersignedEmails(deps, org, o, data, signedBytes, currency, !!countersign.email_producers_on_countersign).catch((e) =>
    console.error("generate-hire-orders: countersigned email failed", { org, orderId: o.id, error: (e as Error).message }));

  return json({ countersigned: true, signed_pdf_path: signedPath });
}

/** Notify the order's producers that the artist countersigned (in-app). Mirrors
 *  documenso-webhook's notifyProducers resolution: resolve_show_assignments on the
 *  order's show_date, falling back to org admins; deduped. */
async function notifyProducersCountersigned(deps: Deps, order: SignOrderRow): Promise<void> {
  const admin = deps.admin;
  const org = order.org_id;
  let recipientIds: string[] = [];
  if (order.show_dates) {
    const { data: producers } = await admin.rpc("resolve_show_assignments", {
      p_program: order.show_dates.shows?.program ?? "",
      p_sub_program: order.show_dates.shows?.sub_program ?? null,
      p_city_id: order.show_dates.city_id,
      p_org: org,
    } as ResolveShowAssignmentsArgs);
    recipientIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id);
  }
  if (recipientIds.length === 0) {
    const { data: admins } = await admin.from("org_memberships").select("user_id").eq("org_id", org).eq("role", "admin");
    recipientIds = ((admins ?? []) as unknown as OrgAdminRow[]).map((a) => a.user_id);
  }
  recipientIds = [...new Set(recipientIds)] as string[];
  if (recipientIds.length === 0) return;
  const rows = recipientIds.map((uid) => ({
    org_id: org, user_id: uid, type: "hire_order_countersigned",
    title: "Hire order countersigned",
    message: `Hire order ${order.order_no} has been countersigned.`,
    related_entity_type: "hire_order", related_entity_id: order.id,
  }));
  await admin.from("notifications").insert(rows);
}

/** A confirmation notification for the signing artist. */
async function notifyArtistCountersigned(deps: Deps, org: string, order: SignOrderRow, userId: string): Promise<void> {
  await deps.admin.from("notifications").insert([{
    org_id: org, user_id: userId, type: "hire_order_countersigned",
    title: "Hire order signed",
    message: `You signed hire order ${order.order_no}.`,
    related_entity_type: "hire_order", related_entity_id: order.id,
  }]);
}

/** Email the artist the signed PDF; optionally email producers too (opt-in flag). */
async function sendCountersignedEmails(
  deps: Deps, org: string, order: SignOrderRow, data: OrderData, signedBytes: Uint8Array,
  _currency: string, emailProducers: boolean,
): Promise<void> {
  const attachment = { filename: `${order.order_no}-signed.pdf`, content_base64: encodeBase64(signedBytes) };
  const templateData = {
    artist_name: strField(data, "artist_name"),
    order_no: order.order_no,
    date_label: dateLabel(strField(data, "date")),
    venue: strField(data, "venue"),
    download_url: `${APP_URL}/hire-orders/${order.id}`,
  };
  const artistEmail = strField(data, "recipient_email");
  if (artistEmail) {
    await deps.sendEmail({
      template_name: "hire-order-countersigned",
      recipient_email: artistEmail,
      org_id: org,
      templateData,
      attachments: [attachment],
      idempotency_key: `hire-order-countersigned-${order.id}`,
    });
  }
  if (!emailProducers) return;
  // Resolve producer emails via auth admin (few per show); best-effort.
  let producerIds: string[] = [];
  if (order.show_dates) {
    const { data: producers } = await deps.admin.rpc("resolve_show_assignments", {
      p_program: order.show_dates.shows?.program ?? "",
      p_sub_program: order.show_dates.shows?.sub_program ?? null,
      p_city_id: order.show_dates.city_id,
      p_org: org,
    } as ResolveShowAssignmentsArgs);
    producerIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id);
  }
  for (const uid of [...new Set(producerIds)]) {
    const { data: got } = await deps.admin.auth.admin.getUserById(uid);
    const email = (got as { user?: { email?: string } } | null)?.user?.email;
    if (!email) continue;
    await deps.sendEmail({
      template_name: "hire-order-countersigned",
      recipient_email: email,
      org_id: org,
      templateData: { ...templateData, _intro: `A hire order for ${templateData.venue || "a show"} has been countersigned by the artist. The signed copy is attached.` },
      attachments: [attachment],
      idempotency_key: `hire-order-countersigned-prod-${order.id}-${uid}`,
    });
  }
}

// ── countersign-test (admin-only, own re-check happens in handle()) ────────

/**
 * Cheap authenticated Documenso connectivity check for the settings card's
 * "Test connection" button. Mirrors airtable-schema's server-side PAT proxy
 * pattern: the token is read from the Vault-backed DOCUMENSO_API_TOKEN edge
 * secret and used ONLY here, never returned to the client. The instance URL is
 * likewise operator-controlled only (see resolveDocumensoBaseUrl) — never a
 * request body field, so this action cannot be pointed at an attacker host.
 * Always resolves 200 with `{ ok, detail }` -- a connectivity failure is data,
 * not a 500.
 */
async function countersignTest(deps: Deps): Promise<Response> {
  const token = deps.env("DOCUMENSO_API_TOKEN");
  if (!token) return json({ ok: false, detail: "Documenso API token is not configured on the server" });

  const baseUrlResult = resolveDocumensoBaseUrl(deps);
  if (!baseUrlResult.ok) return json({ ok: false, detail: baseUrlResult.error });
  try {
    const res = await deps.fetch(`${baseUrlResult.baseUrl}/api/v2/envelope?perPage=1`, {
      headers: { Authorization: documensoAuthHeader(token) },
    });
    if (!res.ok) return json({ ok: false, detail: `documenso_error:${res.status}` });
    return json({ ok: true, detail: "Connected" });
  } catch (e) {
    return json({ ok: false, detail: (e as Error).message });
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Assign a layer field only when the value is meaningful (skip null/undefined/""). */
function assign(layer: Partial<Record<OrderFieldKey, unknown>>, key: OrderFieldKey, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  layer[key] = value;
}

/** Read a resolved snapshot field as a trimmed string ("" when absent). */
function strField(data: OrderData, key: OrderFieldKey): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Lowercase hex SHA-256 of the given bytes (issued-document tamper anchor). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A compact uppercase cast code from a show's reference label; undefined when blank. */
function castCodeFromLabel(label: string | null): string | undefined {
  if (!label) return undefined;
  const slug = label.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  return slug || undefined;
}

/**
 * Human label for an email from a `YYYY-MM-DD` date-only string, e.g. "Mon, Jun 15, 2026".
 * Timezone-safe: the date is CONSTRUCTED at UTC midnight and FORMATTED in UTC (CLAUDE.md
 * calendar rule), so a viewer/server timezone can never shift the day. Non-date input is
 * returned unchanged.
 */
function dateLabel(dateOnly: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateOnly)) return dateOnly;
  const d = new Date(`${dateOnly.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateOnly;
  return d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
