// generate-hire-orders — the hire-order engine. Four per-request actions:
//   draft        create draft orders from confirmed bookings (snapshot fields)
//   issue        validate -> render PDF -> upload -> stamp issued -> email + notify
//   preview      render a watermarked PDF for one order, persist nothing
//   download-url signed URL for an order's PDF (producers + the linked artist)
//
// DI: exports handle(req, deps); Deno.serve wiring at the bottom. Tests inject
// makeFakeDeps (deps.renderHireOrderPdf is stubbed). See index.di.test.ts.
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { requireFeature } from "../_shared/entitlements.ts";
import { resolveOrgSetting } from "../_shared/settings.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  formatOrderNo,
  orderReadyIssues,
  resolveFields,
  withCollisionSuffix,
  type FieldLayers,
  type HireOrderLetterhead,
  type HireOrderTerm,
  type OrderData,
  type OrderFieldKey,
} from "../_shared/hireOrders.ts";

// ── settings shapes + fallbacks (mirror src/components/settings/hireOrders/*) ──

interface Numbering { prefix: string; pattern: string }
interface OrderDefaults { default_fee: number | null; currency: string }
interface TermsVariants { lean: HireOrderTerm[]; standard: HireOrderTerm[]; full: HireOrderTerm[] }
type TermsVariant = keyof TermsVariants;

const NUMBERING_DEFAULT: Numbering = { prefix: "HO", pattern: "{prefix}-{yyyy}-{mmdd}-{cast|seq}" };
const DEFAULTS_DEFAULT: OrderDefaults = { default_fee: null, currency: "EUR" };
const LETTERHEAD_DEFAULT: HireOrderLetterhead = { legal_name: "", address_lines: [] };
const TERMS_DEFAULT: TermsVariants = { lean: [], standard: [], full: [] };

const BUCKET = "hire-orders";
const SIGNED_URL_TTL = 3600;

// deno-lint-ignore no-explicit-any
type Any = any;

// ── entry ──────────────────────────────────────────────────────────────────

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.org_id) return json({ error: "bad_request" }, 400);

  // download-url authorizes artists for their own issued orders, so it CANNOT sit
  // behind the admin/producer gate — it runs its own auth (see downloadUrl).
  if (body.action === "download-url") return downloadUrl(deps, req, body);

  const gate = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!gate.ok) return gate.response;

  const denied = await requireFeature(deps, body.org_id, "hire_orders");
  if (denied) return denied;

  switch (body.action) {
    case "draft":
      return draftOrders(deps, body, gate.userId);
    case "issue":
      return issueOrders(deps, body, gate.userId);
    case "preview":
      return previewOrder(deps, body);
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
  const showDate = sd as Any;

  // Confirmed bookings for the date (optionally a subset), artist joined.
  let bq = admin
    .from("bookings")
    .select("id, artist_id, fee_amount, status, artists(id, name, email, cast_role, user_id)")
    .eq("show_date_id", body.show_date_id)
    .eq("status", "confirmed");
  if (Array.isArray(body.booking_ids) && body.booking_ids.length > 0) bq = bq.in("id", body.booking_ids);
  const { data: bookingRows, error: bErr } = await bq;
  if (bErr) return json({ error: bErr.message }, 500);
  const bookings = (bookingRows ?? []) as Any[];

  const created: string[] = [];
  const skipped: Array<{ booking_id: string; reason: string }> = [];
  if (bookings.length === 0) return json({ created, skipped });

  // Bookings that already hold a non-void order are skipped (mirrors the partial-unique
  // active-booking index — one live order per booking).
  const bookingIds = bookings.map((b) => b.id);
  const { data: existing } = await admin
    .from("hire_orders").select("booking_id").in("booking_id", bookingIds).neq("status", "void");
  const hasOrder = new Set((existing ?? []).map((r: Any) => r.booking_id));

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

  // Sequence base: existing non-void orders for THIS show date (the performance day).
  // Collisions across dates/shows are still caught by the unique index + suffix retry.
  const { count } = await admin
    .from("hire_orders").select("id", { count: "exact", head: true })
    .eq("org_id", org).eq("show_date_id", body.show_date_id).neq("status", "void");
  let seq = count ?? 0;

  const castCode = castCodeFromLabel(showDate.shows?.program ?? null);
  const sessions = [showDate.session_1, showDate.session_2, showDate.session_3].filter(
    (t: unknown): t is string => typeof t === "string" && t !== "",
  );

  for (const b of bookings) {
    if (hasOrder.has(b.id)) {
      skipped.push({ booking_id: b.id, reason: "exists" });
      continue;
    }
    const artist = b.artists ?? {};

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
  }

  // Optional producer notification (mirrors booking_ready_to_confirm recipient
  // resolution): once per recipient for the batch, only if anything was created.
  if (body.notify && created.length > 0) {
    await notifyProducers(deps, org, showDate, created.length);
  }

  return json({ created, skipped });
}

/** Insert with unique-violation retry using the shared collision suffix (max 5 tries). */
async function insertWithRetry(
  admin: Deps["admin"],
  baseOrderNo: string,
  row: Record<string, unknown>,
): Promise<{ id: string } | { reason: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const order_no = withCollisionSuffix(baseOrderNo, attempt);
    const { data, error } = await admin
      .from("hire_orders").insert({ ...row, order_no }).select("id").maybeSingle();
    if (!error && data) return { id: (data as { id: string }).id };
    if (error && (error as { code?: string }).code === "23505") continue; // collision -> next suffix
    if (error) return { reason: (error as { message?: string }).message ?? "insert_failed" };
  }
  return { reason: "order_no_collision" };
}

async function notifyProducers(deps: Deps, org: string, showDate: Any, orderCount: number): Promise<void> {
  const admin = deps.admin;
  const { data: producers } = await admin.rpc("resolve_show_assignments", {
    p_program: showDate.shows?.program ?? "",
    p_sub_program: showDate.shows?.sub_program ?? null,
    p_city_id: showDate.city_id,
    p_org: org,
  });
  let recipientIds = (producers ?? []).map((p: Any) => p.producer_user_id);
  if (recipientIds.length === 0) {
    // Fallback: notify this org's admins.
    const { data: admins } = await admin.from("org_memberships").select("user_id").eq("org_id", org).eq("role", "admin");
    recipientIds = (admins ?? []).map((a: Any) => a.user_id);
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

// ── issue ────────────────────────────────────────────────────────────────

interface IssueBody { org_id: string; order_ids: string[] }

async function issueOrders(deps: Deps, body: IssueBody, _userId: string | null): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  const orderIds = Array.isArray(body.order_ids) ? body.order_ids : [];
  if (orderIds.length === 0) return json({ error: "order_ids required" }, 400);

  const [letterhead, terms, defaults] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(admin, org, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    resolveOrgSetting<TermsVariants>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
  ]);

  const issued: string[] = [];
  const failed: Array<{ order_id: string; issues: string[] }> = [];

  for (const orderId of orderIds) {
    try {
      const outcome = await issueOne(deps, org, orderId, letterhead, terms, defaults);
      if (outcome.ok) issued.push(orderId);
      else failed.push({ order_id: orderId, issues: outcome.issues });
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
): Promise<{ ok: true } | { ok: false; issues: string[] }> {
  const admin = deps.admin;

  const { data: order } = await admin
    .from("hire_orders")
    .select("id, org_id, order_no, status, data, terms_variant, fee_currency, artist_id")
    .eq("id", orderId)
    .eq("org_id", org)
    .maybeSingle();
  if (!order) return { ok: false, issues: ["not_found"] };
  const o = order as Any;

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

  const currency = o.fee_currency ?? defaults.currency ?? "EUR";
  const bytes = await deps.renderHireOrderPdf({
    data,
    orderNo: o.order_no,
    status: "issued",
    letterhead,
    terms: variantTerms,
    currency,
    generatedAtIso: deps.now().toISOString(),
  });

  const path = `${org}/${o.order_no}.pdf`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) return { ok: false, issues: ["upload_failed"] };

  const { error: issueErr } = await admin
    .from("hire_orders")
    .update({ status: "issued", issued_at: deps.now().toISOString(), pdf_path: path })
    .eq("id", orderId);
  if (issueErr) return { ok: false, issues: ["transition_failed"] };

  // Best-effort side effects — a failure here must NOT undo a successful issue.
  await sendIssuedEmail(deps, org, o, data, bytes).catch((e) =>
    console.error("generate-hire-orders: issued email failed", { org, orderId, error: (e as Error).message }),
  );
  await notifyArtist(deps, org, o).catch((e) =>
    console.error("generate-hire-orders: artist notification failed", { org, orderId, error: (e as Error).message }),
  );

  return { ok: true };
}

async function sendIssuedEmail(deps: Deps, org: string, order: Any, data: OrderData, bytes: Uint8Array): Promise<void> {
  const recipient = strField(data, "recipient_email");
  if (!recipient) {
    console.warn("generate-hire-orders: no recipient email, skipping issued email", { org, orderId: order.id });
    return;
  }
  const result = await deps.sendEmail({
    template_name: "hire-order-issued",
    recipient_email: recipient,
    org_id: org,
    templateData: {
      orderNo: order.order_no,
      artistName: strField(data, "artist_name"),
      date: strField(data, "date"),
    },
    attachments: [{ filename: `${order.order_no}.pdf`, content_base64: encodeBase64(bytes) }],
    idempotency_key: `hire-order-issued-${order.id}`,
  });
  if (result.error != null) {
    console.warn("generate-hire-orders: issued email not delivered", { org, orderId: order.id, error: result.error });
  }
}

async function notifyArtist(deps: Deps, org: string, order: Any): Promise<void> {
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
    .select("id, org_id, order_no, data, terms_variant, fee_currency")
    .eq("id", body.order_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!order) return json({ error: "not_found" }, 404);
  const o = order as Any;

  const [letterhead, terms, defaults] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(admin, org, "hire_order_letterhead", LETTERHEAD_DEFAULT),
    resolveOrgSetting<TermsVariants>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrgSetting<OrderDefaults>(admin, org, "hire_order_defaults", DEFAULTS_DEFAULT),
  ]);
  const variant = (o.terms_variant as TermsVariant) ?? "standard";

  const bytes = await deps.renderHireOrderPdf({
    data: o.data as OrderData,
    orderNo: o.order_no,
    status: "preview",
    letterhead,
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
    .select("id, org_id, artist_id, status, pdf_path, order_no")
    .eq("id", body.order_id)
    .eq("org_id", body.org_id)
    .maybeSingle();
  if (!order) return json({ error: "not_found" }, 404);
  const o = order as Any;

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
  if (!o.pdf_path) return json({ error: "no_pdf" }, 409);

  // Sign with the caller's client so storage RLS is the backstop.
  const { data: signed, error: signErr } = await userClient.storage
    .from(BUCKET).createSignedUrl(o.pdf_path, SIGNED_URL_TTL);
  if (signErr || !signed) return json({ error: "sign_failed" }, 500);

  return json({ url: (signed as { signedUrl: string }).signedUrl, expires_in: SIGNED_URL_TTL });
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

/** A compact uppercase cast code from a show's reference label; undefined when blank. */
function castCodeFromLabel(label: string | null): string | undefined {
  if (!label) return undefined;
  const slug = label.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  return slug || undefined;
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
