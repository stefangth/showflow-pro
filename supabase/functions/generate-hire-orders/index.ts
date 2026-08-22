// generate-hire-orders — the hire-order engine. Seven per-request actions:
//   draft            create draft orders from confirmed bookings (snapshot fields)
//   draft-manual     create ONE draft from the V5 wizard: free choice of artist x
//                    date (either/both optional) plus producer-entered manual fields
//   draft-batch      create one aggregate draft per artist across assigned dates
//   issue            validate -> render PDF -> upload -> stamp issued -> email + notify
//                    (+ a Documenso countersign envelope when the org is in that mode)
//   resend           email the immutable stored issued/countersigned PDF again
//   preview          render a watermarked PDF for one order, persist nothing
//   download-url     signed URL for an order's PDF (producers + the linked artist)
//   countersign-test admin-only Documenso connectivity check for the settings card
//   sign             the linked artist signs an issued electronic order: re-render PDF
//                    + certificate, store signed_pdf_path + a hire_order_signatures
//                    audit row, flip to countersigned, notify + email
//
// DI: exports handle(req, deps); Deno.serve wiring at the bottom. Tests inject
// makeFakeDeps (deps.renderHireOrderPdf is stubbed). See index.di.test.ts.
import { json, preflight } from "../_shared/http.ts";
import { requireCronOrRole, requireOrgRole } from "../_shared/auth.ts";
import { requireCapability } from "../_shared/capabilities.ts";
import type {
  Database,
  Json,
  TablesInsert,
  TablesUpdate,
} from "../_shared/database.types.ts";
import type {
  CreateHireOrderWithDatesArgs,
  OrgAdminRow,
  ProducerAssignmentRow,
  ResolveShowAssignmentsArgs,
} from "../_shared/rows.ts";
import { requireFeature } from "../_shared/entitlements.ts";
import { resolveOrgSetting } from "../_shared/settings.ts";
import { type Deps, emailWasSent, realDeps } from "../_shared/deps.ts";
import { APP_URL } from "../_shared/app-url.ts";
import {
  createAndSendEnvelope,
  documensoAuthHeader,
} from "../_shared/documenso.ts";
import {
  decodeBase64,
  encodeBase64,
} from "https://deno.land/std@0.224.0/encoding/base64.ts";
import {
  computeFeeTotal,
  defaultTemplateId,
  type EngagementDate,
  type FeeBasis,
  type FieldLayers,
  formatMoney,
  formatOrderNo,
  type HireOrderLetterhead,
  type HireOrderTerm,
  type HireOrderTermsSetting,
  isFeeBasis,
  normalizeTermsSetting,
  type OrderData,
  type OrderFieldKey,
  orderReadyIssues,
  type RenderSignature,
  resolveEngagementSessions,
  resolveFields,
  resolveTermsClauses,
  type SessionOverride,
  withCollisionSuffix,
} from "../_shared/hireOrders.ts";
import { type HireOrderCopy, resolveHireOrderCopy } from "../_shared/hire-order-pdf/pdfCopy.ts";
import { resolveOrgLocale, type ServerLocale } from "../_shared/orgLocale.ts";
import {
  SAMPLE_ORDER_NO,
  sampleOrderData,
  sampleRenderInput,
} from "../_shared/hire-order-pdf/sampleDocument.ts";
import {
  type HireOrderTheme,
  type HireOrderThemeOverride,
  type LooseRoleStyle,
  resolveHireOrderTheme,
} from "../_shared/hire-order-pdf/pdfTheme.ts";

// ── settings shapes + fallbacks (mirror src/components/settings/hireOrders/*) ──

interface Numbering {
  prefix: string;
  pattern: string;
}
interface OrderDefaults {
  default_fee: number | null;
  currency: string;
  default_fee_basis: FeeBasis;
}
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
interface IssueSnapshot {
  letterhead: HireOrderLetterhead;
  terms: HireOrderTerm[];
  currency: string;
  countersign_mode: string;
  /** Resolved copy dictionary frozen at issue so a countersigned re-render
   *  reproduces the exact issued wording even if the org later edits its copy.
   *  Stored as the FULL resolved record. Legacy snapshots (issued before part E)
   *  lack it -> signOrder falls back to the live setting / defaults. */
  copy?: HireOrderCopy;
  /** Resolved PDF theme frozen at issue so a countersigned re-render reproduces
   *  the exact issued typography/colour even if the org later re-themes. Stored
   *  as the FULL resolved theme (base + roles) -- HireOrderTheme carries only
   *  FontFamilyKey strings, never font FILE BYTES, so freezing it never bloats
   *  the snapshot (see FONT_FAMILIES in pdfTheme.ts). Legacy snapshots (issued
   *  before this) lack it -> signOrder falls back to the live setting / defaults. */
  theme?: HireOrderTheme;
  /** Language frozen at issue (weekday name + money grouping) so a countersigned
   *  re-render reproduces the exact issued formatting even if the org later
   *  switches language or loses the language_packages entitlement. Legacy
   *  snapshots lack it -> the re-render falls back to English. */
  locale?: ServerLocale;
}

const NUMBERING_DEFAULT: Numbering = {
  prefix: "HO",
  pattern: "{prefix}-{yyyy}-{mmdd}-{seq}",
};
const DEFAULTS_DEFAULT: OrderDefaults = {
  default_fee: null,
  currency: "EUR",
  default_fee_basis: "per_date",
};

/**
 * Resolve hire_order_defaults, validating default_fee_basis rather than just
 * null-checking it. resolveOrgSetting (../_shared/settings.ts) replaces the
 * fallback wholesale on a match rather than merging field-by-field, so an
 * org's old {default_fee, currency} row (saved before default_fee_basis
 * existed) resolves with the key entirely absent — and a hand-edited or
 * pre-validation row could carry any other string, or a non-string, in its
 * place. A plain `?? "per_date"` would pass a value like `""` straight
 * through as if it were legal: downstream that silently multiplies fees as
 * "per_date" while the PDF's per-date breakdown line (keyed on the literal
 * "per_date") never renders — a correct total with a missing explanation,
 * the kind of bug nobody can reproduce. Falling back to "per_date" for
 * anything that isn't exactly "per_date" or "total" closes that gap.
 *
 * Exported (the file's only other export is `handle`) so index.di.test.ts can
 * exercise the validation directly instead of threading it through an action
 * whose response happens to expose default_fee_basis.
 */
export async function resolveOrderDefaults(
  admin: Deps["admin"],
  org: string,
): Promise<OrderDefaults> {
  const raw = await resolveOrgSetting<OrderDefaults>(
    admin,
    org,
    "hire_order_defaults",
    DEFAULTS_DEFAULT,
  );
  return {
    ...raw,
    default_fee_basis: isFeeBasis(raw.default_fee_basis) ? raw.default_fee_basis : "per_date",
  };
}
const LETTERHEAD_DEFAULT: HireOrderLetterhead = {
  legal_name: "",
  address_lines: [],
};
const TERMS_DEFAULT: HireOrderTermsSetting = {
  templates: [],
  default_id: null,
};
/** Fallback template id when the org has authored no templates at all (empty-template
 *  orgs get no real default_id from `defaultTemplateId`); kept only so drafts always
 *  carry a string — the readiness/missing_terms gate blocks issuing such an order
 *  regardless of which id it stores. */
const FALLBACK_TERMS_VARIANT = "standard";
const COUNTERSIGN_DEFAULT: Countersign = { mode: "manual" };
/** No stored overrides -> resolveHireOrderCopy fills every key from the defaults. */
const COPY_DEFAULT: Partial<HireOrderCopy> = {};
/** No stored overrides -> resolveHireOrderTheme fills every key from the defaults. */
const THEME_DEFAULT: HireOrderThemeOverride = {};

/**
 * Layer an ad-hoc theme override (unsaved editor edits) over the org's stored
 * theme override, field by field at EVERY depth -- not wholesale per top-level
 * group and not wholesale per role key. `base.colors`/`base.page` and each
 * role's individual style fields (family/size/weight/color/letterSpacing/
 * transform) are all objects a caller may send only a partial update for, so a
 * shallow `{...stored.base, ...adhoc.base}` (or `{...stored.roles, ...adhoc.roles}`)
 * would let a preview that tweaks a single field of one role silently drop the
 * rest of that role's (or that group's) stored customization. Both inputs are
 * themselves untrusted/partial JSON (mirrors HireOrderThemeOverride's own
 * looseness); resolveHireOrderTheme remains the only narrowing point -- this
 * only merges the two override layers before handing them to it.
 */
function layerThemeOverride(
  stored: HireOrderThemeOverride,
  adhoc: HireOrderThemeOverride | undefined,
): HireOrderThemeOverride {
  const roleKeys = new Set<string>([
    ...Object.keys(stored.roles ?? {}),
    ...Object.keys(adhoc?.roles ?? {}),
  ]);
  const roles: Record<string, LooseRoleStyle> = {};
  for (const key of roleKeys) {
    roles[key] = { ...(stored.roles?.[key] ?? {}), ...(adhoc?.roles?.[key] ?? {}) };
  }
  return {
    base: {
      ...stored.base,
      ...adhoc?.base,
      colors: { ...stored.base?.colors, ...adhoc?.base?.colors },
      page: { ...stored.base?.page, ...adhoc?.base?.page },
    },
    roles,
  };
}

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
function resolveDocumensoBaseUrl(
  deps: Deps,
): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const raw = deps.env("DOCUMENSO_BASE_URL");
  const baseUrl = raw && raw.trim() !== "" ? raw : DOCUMENSO_DEFAULT_BASE_URL;
  if (!baseUrl.startsWith("https://")) {
    return { ok: false, error: "documenso_base_url_invalid" };
  }
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

/** Minimal order shape needed to compose an issued/resend delivery email. */
interface EmailOrderRow {
  id: string;
  order_no: string;
}

/** Shape of resendOrder's hire_orders select. */
interface ResendOrderRow extends EmailOrderRow {
  status: string;
  data: OrderData;
  artist_id: string | null;
  pdf_path: string | null;
  signed_pdf_path: string | null;
  fee_currency: string | null;
  countersign_mode: string | null;
  issue_snapshot: Pick<IssueSnapshot, "countersign_mode" | "locale"> | null;
}

// ── entry ──────────────────────────────────────────────────────────────────

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.org_id) {
    return json({ error: "bad_request" }, 400);
  }

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

  // Producer capability gate for draft/draft-manual/issue. Admins/super-admins and
  // cron callers already passed the gate above (org role or the cron secret) and
  // bypass this entirely; a caller who is only a producer (not admin) additionally
  // needs the per-action capability. preview, download-url (its own auth, earlier),
  // and countersign-test (admin-only, re-checked in its own case below) stay ungated.
  if (!isCron && (body.action === "draft" || body.action === "draft-manual" || body.action === "issue")) {
    const adminGate = await requireOrgRole(deps, req, body.org_id, ["admin"]);
    if (!adminGate.ok) {
      const capability = body.action === "issue" ? "producer_can_issue_hire_orders" : "producer_can_generate_hire_orders";
      const capGate = await requireCapability(deps, body.org_id, capability);
      if (capGate) return capGate;
    }
  }

  switch (body.action) {
    case "draft":
      return draftOrders(deps, body, gate.userId);
    case "draft-manual":
      return draftManual(deps, body, gate.userId);
    case "draft-batch":
      return draftBatch(deps, body, gate.userId);
    case "issue":
      return issueOrders(deps, body, gate.userId);
    case "resend":
      return resendOrder(deps, body);
    case "preview":
      return previewOrder(deps, body);
    case "upload-agent-signature": {
      // Admin-only (mirrors countersign-test): the coarse gate above accepts
      // admin OR producer, so re-check admin here. Feature already gated above.
      const adminGate = await requireOrgRole(deps, req, body.org_id, ["admin"]);
      if (!adminGate.ok) return adminGate.response;
      return uploadAgentSignature(deps, body);
    }
    case "agent-signature-url": {
      const adminGate = await requireOrgRole(deps, req, body.org_id, ["admin"]);
      if (!adminGate.ok) return adminGate.response;
      return agentSignatureUrl(deps, body);
    }
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

interface DraftBody {
  org_id: string;
  show_date_id: string;
  booking_ids?: string[];
  notify?: boolean;
}

async function draftOrders(
  deps: Deps,
  body: DraftBody,
  userId: string | null,
): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  if (!body.show_date_id) return json({ error: "show_date_id required" }, 400);

  // Show date (org-scoped) with its show, for the snapshot + order-number cast code.
  const { data: sd } = await admin
    .from("show_dates")
    .select(
      "id, org_id, show_id, city_id, date, venue, duration_minutes, notes, session_1, session_2, session_3, shows(program, sub_program)",
    )
    .eq("id", body.show_date_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!sd) return json({ error: "show_date_not_found" }, 404);
  const showDate = sd as unknown as ShowDateRow;

  // Confirmed bookings for the date (optionally a subset), artist joined.
  let bq = admin
    .from("bookings")
    .select(
      "id, artist_id, fee_amount, status, artists(id, name, email, cast_role, user_id)",
    )
    .eq("show_date_id", body.show_date_id)
    .eq("status", "confirmed");
  if (Array.isArray(body.booking_ids) && body.booking_ids.length > 0) {
    bq = bq.in("id", body.booking_ids);
  }
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
    .from("hire_orders").select("booking_id").in("booking_id", bookingIds).neq(
      "status",
      "void",
    );
  const hasOrder = new Set(
    ((existing ?? []) as unknown as { booking_id: string }[]).map((r) =>
      r.booking_id
    ),
  );

  // Settings for the snapshot + numbering + the org's default terms template.
  const [defaults, numbering, rawTerms] = await Promise.all([
    resolveOrderDefaults(admin, org),
    resolveOrgSetting<Numbering>(
      admin,
      org,
      "hire_order_numbering",
      NUMBERING_DEFAULT,
    ),
    resolveOrgSetting<unknown>(admin, org, "hire_order_terms", TERMS_DEFAULT),
  ]);
  const termsSetting = normalizeTermsSetting(rawTerms);
  const defaultTermsVariant = defaultTemplateId(termsSetting) ??
    FALLBACK_TERMS_VARIANT;

  // City name (showflow field).
  let cityName: string | null = null;
  if (showDate.city_id) {
    const { data: c } = await admin.from("cities").select("name").eq(
      "id",
      showDate.city_id,
    ).maybeSingle();
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
    .eq("org_id", org).eq("show_dates.date", showDate.date).neq(
      "status",
      "void",
    );
  let seq = count ?? 0;

  const castCode = castCodeFromLabel(showDate.shows?.program ?? null);
  const sessions = [showDate.session_1, showDate.session_2, showDate.session_3]
    .filter(
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
      const defLayer: Partial<Record<OrderFieldKey, unknown>> = {
        currency: defaults.currency,
      };
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
      const feeAmount =
        feeValue === undefined || feeValue === null || feeValue === ""
          ? null
          : Number(feeValue);
      const row = {
        org_id: org,
        status: "draft" as const,
        booking_id: b.id,
        artist_id: b.artist_id,
        show_date_id: body.show_date_id,
        data,
        fee_amount: feeAmount,
        fee_currency: defaults.currency,
        terms_variant: defaultTermsVariant,
        created_by: userId,
      };

      const result = await insertWithRetry(admin, baseOrderNo, row);
      if ("id" in result) created.push(result.id);
      else skipped.push({ booking_id: b.id, reason: result.reason });
    } catch (e) {
      console.error("generate-hire-orders: draft failed for booking", {
        org,
        bookingId: b.id,
        error: (e as Error).message,
      });
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
      .from("hire_orders").insert(
        { ...row, order_no } as unknown as TablesInsert<"hire_orders">,
      ).select("id").maybeSingle();
    if (!error && data) return { id: (data as { id: string }).id };
    if (error && (error as { code?: string }).code === "23505") {
      if (isActiveArtistDateConflict(error)) return { reason: "exists" };
      continue; // order_no collision -> next suffix
    }
    if (error) {
      return {
        reason: (error as { message?: string }).message ?? "insert_failed",
      };
    }
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

async function notifyProducers(
  deps: Deps,
  org: string,
  showDate: ShowDateRow,
  orderCount: number,
): Promise<void> {
  const admin = deps.admin;
  const { data: producers } = await admin.rpc("resolve_show_assignments", {
    p_program: showDate.shows?.program ?? "",
    p_sub_program: showDate.shows?.sub_program ?? null,
    p_city_id: showDate.city_id,
    p_org: org,
    // The SQL function accepts NULL sub_program/city_id; type-gen doesn't model that.
  } as ResolveShowAssignmentsArgs);
  let recipientIds = ((producers ?? []) as unknown as ProducerAssignmentRow[])
    .map((p) => p.producer_user_id);
  if (recipientIds.length === 0) {
    // Fallback: notify this org's admins.
    const { data: admins } = await admin.from("org_memberships").select(
      "user_id",
    ).eq("org_id", org).eq("role", "admin");
    recipientIds = ((admins ?? []) as unknown as OrgAdminRow[]).map((a) =>
      a.user_id
    );
  }
  recipientIds = [...new Set(recipientIds)] as string[];
  if (recipientIds.length === 0) return;

  const rows = recipientIds.map((uid: string) => ({
    org_id: org,
    user_id: uid,
    type: "hire_orders_ready",
    title: "Hire orders ready",
    message: `${orderCount} hire ${
      orderCount === 1 ? "order is" : "orders are"
    } drafted and ready to review.`,
    related_entity_type: "show_date",
    related_entity_id: showDate.id,
  }));
  const { error } = await admin.from("notifications").insert(rows);
  if (error) {
    console.error("generate-hire-orders: producer notification insert failed", {
      org,
      error: error.message,
    });
  }
}

// ── draft-manual ─────────────────────────────────────────────────────────

interface DraftManualBody {
  org_id: string;
  artist_id?: string;
  show_date_id?: string;
  manual?: Partial<Record<OrderFieldKey, unknown>>;
  /** How `manual.fee` should be read. Same contract as draft-batch's: top-level
   *  because the basis is not an editable order field, and omitted falls back
   *  to the org's `default_fee_basis`. */
  fee_basis?: FeeBasis;
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
async function draftManual(
  deps: Deps,
  body: DraftManualBody,
  userId: string | null,
): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  const manual = body.manual ?? {};

  // A manual fee is producer-typed free text (V5 wizard step 2). `Number(feeValue)`
  // on a non-numeric value yields NaN, which JSON-serializes to `null` on insert —
  // silently dropping the entered value instead of rejecting the bad input. Reject
  // outright when a fee WAS provided but isn't a finite number; a genuinely absent
  // fee (undefined/null/"") keeps falling through to the existing null behavior.
  const manualFeeRaw = manual.fee;
  const manualFeeProvided = manualFeeRaw !== undefined &&
    manualFeeRaw !== null && manualFeeRaw !== "";
  if (manualFeeProvided && !Number.isFinite(Number(manualFeeRaw))) {
    return json({ error: "invalid_fee" }, 400);
  }
  // Same gate, same error code as draft-batch: one action accepting a basis the
  // other rejects is how an illegal value reaches a snapshot in the first place.
  if (body.fee_basis !== undefined && !isFeeBasis(body.fee_basis)) {
    return json({ error: "invalid_fee_basis" }, 400);
  }

  const [defaults, numbering, rawTerms] = await Promise.all([
    resolveOrderDefaults(admin, org),
    resolveOrgSetting<Numbering>(
      admin,
      org,
      "hire_order_numbering",
      NUMBERING_DEFAULT,
    ),
    resolveOrgSetting<unknown>(admin, org, "hire_order_terms", TERMS_DEFAULT),
  ]);
  const defaultTermsVariant =
    defaultTemplateId(normalizeTermsSetting(rawTerms)) ??
      FALLBACK_TERMS_VARIANT;

  const showflow: Partial<Record<OrderFieldKey, unknown>> = {};
  let castCode: string | undefined;
  let numberingDate: string | undefined;

  if (body.artist_id && body.show_date_id) {
    const [{ data: artistRow }, { data: sdRow }] = await Promise.all([
      admin.from("artists").select("id, name, email, cast_role").eq(
        "id",
        body.artist_id,
      ).eq("org_id", org).maybeSingle(),
      admin.from("show_dates")
        .select(
          "id, date, venue, city_id, duration_minutes, session_1, session_2, session_3, shows(program, sub_program)",
        )
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
        const { data: c } = await admin.from("cities").select("name").eq(
          "id",
          sd.city_id,
        ).maybeSingle();
        assign(showflow, "city", (c as { name?: string } | null)?.name ?? null);
      }
      castCode = castCodeFromLabel(sd.shows?.program ?? null);
      numberingDate = sd.date;
    }
  }

  const defLayer: Partial<Record<OrderFieldKey, unknown>> = {
    currency: defaults.currency,
  };
  assign(defLayer, "fee", defaults.default_fee);

  const layers: FieldLayers = { showflow, manual, defaults: defLayer };
  const data = resolveFields(layers);

  if (!numberingDate && typeof manual.date === "string" && manual.date) {
    numberingDate = manual.date;
  }

  // Sequence base: a simple org-wide non-void count. draftOrders scopes its
  // sequence per calendar day via a join through the linked show_date, but a
  // wizard order may have none to join on — an org-wide count is always
  // available and, combined with insertWithRetry's collision-suffix retry, is
  // still a correct (if less tightly differentiated) base.
  const { count } = await admin.from("hire_orders").select("id", {
    count: "exact",
    head: true,
  }).eq("org_id", org).neq("status", "void");
  const seq = (count ?? 0) + 1;

  const baseOrderNo = formatOrderNo(numbering.pattern, {
    prefix: numbering.prefix,
    date: numberingDate,
    castCode,
    seq,
  });

  const feeValue = data.fee?.value;
  const feeAmount =
    feeValue === undefined || feeValue === null || feeValue === ""
      ? null
      : Number(feeValue);
  // Record how the entered fee was meant to be read, exactly as draft-batch
  // does. A manual order is single-date, so per-date x 1 is the entered amount
  // and no total changes here — only the snapshot gains the explanation the
  // wizard already shows the producer on step 4. Both keys stay ABSENT when
  // there is no fee: there would be nothing for them to explain, and that is
  // the shape the PDF renderer's reconcile guard expects.
  if (feeAmount !== null) {
    const feeBasis: FeeBasis = body.fee_basis ?? defaults.default_fee_basis;
    const feeSource = data.fee?.source ?? "manual";
    data.fee_basis = { value: feeBasis, source: feeSource };
    if (feeBasis === "per_date") {
      data.fee_per_date = { value: feeAmount, source: feeSource };
    }
  }
  // fee_currency follows the RESOLVED currency (which a producer can override at
  // step 2), not blindly the org default — draftOrders can hardcode the org
  // default because a booking never carries its own currency; a wizard order can.
  const currencyValue = data.currency?.value;
  const currency = typeof currencyValue === "string" && currencyValue
    ? currencyValue
    : defaults.currency;

  const row = {
    org_id: org,
    status: "draft" as const,
    booking_id: null,
    artist_id: body.artist_id ?? null,
    show_date_id: body.show_date_id ?? null,
    data,
    fee_amount: feeAmount,
    fee_currency: currency,
    terms_variant: defaultTermsVariant,
    created_by: userId,
  };

  const result = await insertWithRetry(admin, baseOrderNo, row);
  if ("id" in result) return json({ created: [result.id] });
  // An artist/date duplicate (hire_orders_active_artist_date_uniq) is a legitimate
  // skip, not an error -- the wizard already has an active order for this exact
  // artist x date pair. Report it the same shape a batch import does, rather than
  // as a generic error (and, upstream in insertWithRetry, without a 20-attempt
  // suffix retry that could never resolve it).
  if (result.reason === "exists") {
    return json({ created: [], skipped: [{ reason: "exists" }] });
  }
  return json({ created: [], error: result.reason });
}

// ── draft-batch ─────────────────────────────────────────────────────────

interface DraftBatchArtistInput {
  artist_id: string;
  show_date_ids: string[];
}

interface DraftBatchBody {
  org_id: string;
  artists: DraftBatchArtistInput[];
  manual?: NonNullable<FieldLayers["manual"]>;
  /** How `manual.fee` should be read. Top-level rather than inside `manual`
   *  because the basis is not an editable order field. Omitted falls back to
   *  the org's `default_fee_basis`. */
  fee_basis?: FeeBasis;
  /** Per-date running-order + duration overrides, keyed by show_date_id. Each
   *  key must be one of the request's selected show_date_ids. */
  date_overrides?: Record<string, SessionOverride>;
}

interface DraftBatchResult {
  created: string[];
  skipped: Array<{ artist_id: string; reason: string }>;
  errors: Array<{ artist_id: string; reason: string }>;
  /** Partial success: an order WAS created for the artist, but these of their
   *  requested dates were dropped because an active order already covered them. */
  date_conflicts: Array<{ artist_id: string; dropped: string[] }>;
}

interface BatchDraftContext {
  deps: Deps;
  org: string;
  userId: string | null;
  manual: NonNullable<FieldLayers["manual"]>;
  defaults: OrderDefaults;
  numbering: Numbering;
  /** Resolved once for the batch: the request's basis, else the org default. */
  feeBasis: FeeBasis;
  /** The org's default terms-template id, resolved once for the whole batch. */
  defaultTermsVariant: string;
  artistsById: Map<string, ManualArtistRow>;
  datesById: Map<string, ShowDateRow>;
  cityNamesById: Map<string, string>;
  /** Validated per-date session/duration overrides, keyed by show_date_id. */
  dateOverrides: Record<string, SessionOverride>;
  nextSeq: number;
}

type BatchArtistOutcome =
  | { kind: "created"; id: string; droppedDates: string[] }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; reason: string };

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalUuid(value: unknown): string | null {
  return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * Validate the batch's optional `date_overrides` map. Every key must
 * canonicalize to a show_date_id present in `selectedShowDateIds` (the union
 * of the request's own artists[].show_date_ids); each override's `sessions`
 * (if present) must be an array of at most 3 non-blank (post-trim) strings;
 * each `duration_min` (if present) must be `null` or a finite number `>= 0`.
 * Returns `null` on any violation, else a normalized map keyed by canonical
 * show_date_id with trimmed session strings.
 */
function validateDateOverrides(
  raw: DraftBatchBody["date_overrides"],
  selectedShowDateIds: Set<string>,
): Record<string, SessionOverride> | null {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const result: Record<string, SessionOverride> = {};
  for (const [rawKey, rawOverride] of Object.entries(raw)) {
    const dateId = canonicalUuid(rawKey);
    if (!dateId || !selectedShowDateIds.has(dateId)) return null;
    if (
      !rawOverride || typeof rawOverride !== "object" ||
      Array.isArray(rawOverride)
    ) {
      return null;
    }

    const override: SessionOverride = {};
    if ("sessions" in rawOverride) {
      const rawSessions = rawOverride.sessions;
      if (!Array.isArray(rawSessions) || rawSessions.length > 3) return null;
      const sessions: string[] = [];
      for (const session of rawSessions) {
        if (typeof session !== "string") return null;
        const trimmed = session.trim();
        if (trimmed === "") return null;
        sessions.push(trimmed);
      }
      override.sessions = sessions;
    }
    if ("duration_min" in rawOverride) {
      const rawDuration = rawOverride.duration_min;
      if (
        rawDuration !== null &&
        !(typeof rawDuration === "number" && Number.isFinite(rawDuration) &&
          rawDuration >= 0)
      ) {
        return null;
      }
      override.duration_min = rawDuration;
    }
    result[dateId] = override;
  }
  return result;
}

async function draftBatch(
  deps: Deps,
  body: DraftBatchBody,
  userId: string | null,
): Promise<Response> {
  const rawArtists = body.artists;
  if (!Array.isArray(rawArtists) || rawArtists.length === 0) {
    return json({ error: "artists required" }, 400);
  }
  if (
    body.manual !== undefined &&
    (!body.manual || typeof body.manual !== "object" ||
      Array.isArray(body.manual))
  ) {
    return json({ error: "invalid_manual" }, 400);
  }

  const seenArtists = new Set<string>();
  const normalizedArtists: DraftBatchArtistInput[] = [];
  for (const item of rawArtists) {
    if (
      !item || typeof item.artist_id !== "string" ||
      item.artist_id.trim() === ""
    ) {
      return json({ error: "artist_id required" }, 400);
    }
    const artistId = canonicalUuid(item.artist_id);
    if (!artistId) return json({ error: "invalid_artist_id" }, 400);
    if (seenArtists.has(artistId)) {
      return json({ error: "duplicate_artist_id" }, 400);
    }
    seenArtists.add(artistId);
    if (!Array.isArray(item.show_date_ids) || item.show_date_ids.length === 0) {
      return json({ error: "show_date_ids required" }, 400);
    }
    const showDateIds: string[] = [];
    for (const id of item.show_date_ids) {
      const showDateId = canonicalUuid(id);
      if (!showDateId) return json({ error: "invalid_show_date_id" }, 400);
      showDateIds.push(showDateId);
    }
    if (new Set(showDateIds).size !== showDateIds.length) {
      return json({ error: "duplicate_show_date_id" }, 400);
    }
    normalizedArtists.push({ artist_id: artistId, show_date_ids: showDateIds });
  }

  const manual = body.manual ?? {};
  const manualFeeRaw = manual.fee;
  const manualFeeProvided = manualFeeRaw !== undefined &&
    manualFeeRaw !== null && manualFeeRaw !== "";
  if (manualFeeProvided && !Number.isFinite(Number(manualFeeRaw))) {
    return json({ error: "invalid_fee" }, 400);
  }
  // isFeeBasis, never a hand-rolled pair of !== comparisons: its
  // Record<FeeBasis, true> sentinel picks up a future third member at compile
  // time, so resolveOrderDefaults would accept one that a hand-rolled check
  // here would still 400 on. That divergence is what the sentinel exists to
  // prevent.
  if (body.fee_basis !== undefined && !isFeeBasis(body.fee_basis)) {
    return json({ error: "invalid_fee_basis" }, 400);
  }

  const selectedShowDateIds = new Set(
    normalizedArtists.flatMap((item) => item.show_date_ids),
  );
  const dateOverrides = validateDateOverrides(
    body.date_overrides,
    selectedShowDateIds,
  );
  if (dateOverrides === null) {
    return json({ error: "invalid_date_override" }, 400);
  }

  const admin = deps.admin;
  const org = body.org_id;
  const artistIds = normalizedArtists.map((item) => item.artist_id);
  const showDateIds = [...selectedShowDateIds];
  const [
    artistResult,
    dateResult,
    defaults,
    numbering,
    rawTerms,
    sequenceResult,
  ] = await Promise.all([
    admin.from("artists")
      .select("id, name, email, cast_role")
      .eq("org_id", org)
      .in("id", artistIds),
    admin.from("show_dates")
      .select(
        "id, org_id, show_id, city_id, date, venue, duration_minutes, notes, session_1, session_2, session_3, shows(program, sub_program)",
      )
      .eq("org_id", org)
      .in("id", showDateIds),
    resolveOrderDefaults(admin, org),
    resolveOrgSetting<Numbering>(
      admin,
      org,
      "hire_order_numbering",
      NUMBERING_DEFAULT,
    ),
    resolveOrgSetting<unknown>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    admin.from("hire_orders")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org)
      .neq("status", "void"),
  ]);
  if (artistResult.error) return json({ error: "artist_lookup_failed" }, 500);
  if (dateResult.error) return json({ error: "show_date_lookup_failed" }, 500);
  const defaultTermsVariant =
    defaultTemplateId(normalizeTermsSetting(rawTerms)) ??
      FALLBACK_TERMS_VARIANT;

  const artists = (artistResult.data ?? []) as unknown as ManualArtistRow[];
  const dates = (dateResult.data ?? []) as unknown as ShowDateRow[];
  const artistsById = new Map(artists.map((artist) => [artist.id, artist]));
  const datesById = new Map(dates.map((date) => [date.id, date]));

  const cityIds = [
    ...new Set(
      dates.map((date) => date.city_id).filter((id): id is string => !!id),
    ),
  ];
  let cityNamesById = new Map<string, string>();
  if (cityIds.length > 0) {
    const { data: cityRows, error: cityError } = await admin.from("cities")
      .select("id, name").in("id", cityIds);
    if (cityError) return json({ error: "city_lookup_failed" }, 500);
    cityNamesById = new Map(
      ((cityRows ?? []) as unknown as Array<{ id: string; name: string }>).map((
        city,
      ) => [city.id, city.name]),
    );
  }

  const context: BatchDraftContext = {
    deps,
    org,
    userId,
    manual,
    defaults,
    numbering,
    // No third fallback: resolveOrderDefaults already guarantees
    // default_fee_basis is a legal FeeBasis.
    feeBasis: body.fee_basis ?? defaults.default_fee_basis,
    defaultTermsVariant,
    artistsById,
    datesById,
    cityNamesById,
    dateOverrides,
    nextSeq: sequenceResult.count ?? 0,
  };
  const result: DraftBatchResult = { created: [], skipped: [], errors: [], date_conflicts: [] };

  for (const input of normalizedArtists) {
    try {
      const outcome = await draftBatchArtist(context, input);
      if (outcome.kind === "created") {
        result.created.push(outcome.id);
        if (outcome.droppedDates.length > 0) {
          result.date_conflicts.push({ artist_id: input.artist_id, dropped: outcome.droppedDates });
        }
      } else if (outcome.kind === "skipped") {
        result.skipped.push({
          artist_id: input.artist_id,
          reason: outcome.reason,
        });
      } else {result.errors.push({
          artist_id: input.artist_id,
          reason: outcome.reason,
        });}
    } catch (error) {
      console.error("generate-hire-orders: batch draft failed", {
        org,
        artistId: input.artist_id,
        error: (error as Error).message,
      });
      result.errors.push({ artist_id: input.artist_id, reason: "error" });
    }
  }

  // Omit date_conflicts when empty so callers/tests that predate partial success
  // see the exact same {created, skipped, errors} shape as before.
  const { date_conflicts, ...rest } = result;
  return json(date_conflicts.length > 0 ? result : rest);
}

/**
 * Which of `requested` show-date ids are already covered by an ACTIVE (non-void)
 * hire order for this artist in this org -- the legacy hire_orders.show_date_id
 * or an aggregate hire_order_dates child. Mirrors what
 * assert_hire_order_dates_available raises on, but as a READ so the batch can DROP
 * the covered dates and still create the order for the rest (partial success)
 * instead of failing the whole artist. `neq` isn't a real filter in the test fake,
 * so void rows are also filtered in TS.
 */
async function coveredDatesForArtist(
  admin: Deps["admin"],
  org: string,
  artist: string,
  requested: string[],
): Promise<Set<string>> {
  const requestedSet = new Set(requested);
  const covered = new Set<string>();
  const { data: orderRows } = await admin
    .from("hire_orders")
    .select("id, show_date_id, status")
    .eq("org_id", org)
    .eq("artist_id", artist)
    .neq("status", "void");
  const active = ((orderRows ?? []) as Array<
    { id: string; show_date_id: string | null; status: string }
  >).filter((o) => o.status !== "void");
  for (const o of active) {
    if (o.show_date_id && requestedSet.has(o.show_date_id)) covered.add(o.show_date_id);
  }
  const activeIds = active.map((o) => o.id);
  if (activeIds.length > 0) {
    const { data: linkRows } = await admin
      .from("hire_order_dates")
      .select("show_date_id, hire_order_id")
      .in("hire_order_id", activeIds);
    for (
      const l of (linkRows ?? []) as Array<{ show_date_id: string; hire_order_id: string }>
    ) {
      if (requestedSet.has(l.show_date_id)) covered.add(l.show_date_id);
    }
  }
  return covered;
}

/** Draft exactly one aggregate parent and its ordered child-date rows. */
async function draftBatchArtist(
  context: BatchDraftContext,
  input: DraftBatchArtistInput,
): Promise<BatchArtistOutcome> {
  const {
    deps,
    org,
    userId,
    manual,
    defaults,
    numbering,
    feeBasis,
    defaultTermsVariant,
    artistsById,
    datesById,
    cityNamesById,
    dateOverrides,
  } = context;
  const artist = artistsById.get(input.artist_id);
  if (!artist) return { kind: "error", reason: "artist_not_found" };

  const allDates: ShowDateRow[] = [];
  for (const id of input.show_date_ids) {
    const date = datesById.get(id);
    if (!date) return { kind: "error", reason: "show_date_not_found" };
    allDates.push(date);
  }

  // Partial success: drop the dates an active order already covers for this
  // artist and create the order for the rest; skip only if EVERY date is covered.
  const covered = await coveredDatesForArtist(
    deps.admin,
    org,
    input.artist_id,
    input.show_date_ids,
  );
  const dates = allDates.filter((d) => !covered.has(d.id));
  if (dates.length === 0) return { kind: "skipped", reason: "exists" };
  const droppedDates = allDates.filter((d) => covered.has(d.id)).map((d) => d.id);

  dates.sort((a, b) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  );

  const firstDate = dates[0];
  const engagementDates: EngagementDate[] = dates.map((date) => {
    const dateSessions = [date.session_1, date.session_2, date.session_3]
      .filter(
        (time: unknown): time is string =>
          typeof time === "string" && time !== "",
      );
    const resolved = resolveEngagementSessions(
      { sessions: dateSessions, duration_min: date.duration_minutes },
      dateOverrides[date.id],
    );
    return {
      show_date_id: date.id,
      date: date.date,
      venue: date.venue,
      city: date.city_id ? cityNamesById.get(date.city_id) ?? null : null,
      sessions: resolved.sessions,
      duration_min: resolved.duration_min,
    };
  });

  const showflow: NonNullable<FieldLayers["showflow"]> = {};
  assign(showflow, "artist_name", artist.name);
  assign(showflow, "recipient_email", artist.email);
  assign(showflow, "role", artist.cast_role);
  assign(showflow, "date", engagementDates[0].date);
  assign(showflow, "venue", engagementDates[0].venue);
  assign(showflow, "city", engagementDates[0].city);
  assign(showflow, "duration_min", engagementDates[0].duration_min);
  const firstSessions = engagementDates[0].sessions ?? [];
  if (firstSessions.length > 0) showflow.sessions = firstSessions;

  const defaultLayer: NonNullable<FieldLayers["defaults"]> = {
    currency: defaults.currency,
  };
  assign(defaultLayer, "fee", defaults.default_fee);
  const data = resolveFields({ showflow, manual, defaults: defaultLayer });
  data.engagement_dates = { value: engagementDates, source: "showflow" };

  context.nextSeq += 1;
  const baseOrderNo = formatOrderNo(numbering.pattern, {
    prefix: numbering.prefix,
    date: firstDate.date,
    castCode: castCodeFromLabel(firstDate.shows?.program ?? null),
    seq: context.nextSeq,
  });
  // `data.fee` is the amount the producer entered. For a per-date basis it is a
  // UNIT price, so the stored fee becomes unit x the dates that SURVIVED the
  // covered-date drop above (`dates`, not `allDates`): a 3-date request that
  // drops one already-covered date bills 2. The stored `fee` is always the TOTAL
  // payable, which is what every consumer (KPIs, readiness, the PDF total)
  // expects; `fee_basis` and `fee_per_date` only explain how it was reached.
  const enteredFeeValue = data.fee?.value;
  const enteredFee =
    enteredFeeValue === undefined || enteredFeeValue === null ||
      enteredFeeValue === ""
      ? null
      : Number(enteredFeeValue);
  // Guard the persistence boundary. computeFeeTotal is deliberately total: it
  // returns the amount unchanged for a date count that is not a positive
  // integer, because the wizard also calls it for live display where a zero
  // count is a normal transient state mid-edit. That leniency is wrong HERE,
  // where the result is about to be billed: a zero count would silently store
  // the single-date fee as the whole engagement's total. `dates.length >= 1` is
  // already guaranteed by the early return above, so this can only fire if a
  // future refactor removes that guard.
  if (!Number.isInteger(dates.length) || dates.length < 1) {
    return { kind: "error", reason: "no_billable_dates" };
  }
  const feeAmount = enteredFee === null
    ? null
    : computeFeeTotal(enteredFee, dates.length, feeBasis);
  if (feeAmount !== null) {
    const feeSource = data.fee?.source ?? "manual";
    data.fee = { value: feeAmount, source: feeSource };
    data.fee_basis = { value: feeBasis, source: feeSource };
    if (feeBasis === "per_date") {
      data.fee_per_date = { value: enteredFee, source: feeSource };
    }
  }
  const currencyValue = data.currency?.value;
  const currency = typeof currencyValue === "string" && currencyValue
    ? currencyValue
    : defaults.currency;
  const parent = await createBatchHireOrderWithRetry(
    deps.admin,
    baseOrderNo,
    {
      p_org: org,
      p_artist: input.artist_id,
      p_show_date_ids: dates.map((date) => date.id),
      p_data: data as unknown as Json,
      p_fee_amount: feeAmount,
      p_fee_currency: currency,
      p_terms_variant: defaultTermsVariant,
      p_created_by: userId,
    },
  );
  if ("id" in parent) return { kind: "created", id: parent.id, droppedDates };
  return parent.reason === "exists"
    ? { kind: "skipped", reason: parent.reason }
    : { kind: "error", reason: parent.reason };
}

/**
 * Create an aggregate parent and its ordered child rows in the database's
 * transaction. Unlike the legacy single-date insert, a compensating update
 * cannot make a partial aggregate safe: the RPC must either create every row
 * or create none. Order-number collisions remain retryable.
 */
async function createBatchHireOrderWithRetry(
  admin: Deps["admin"],
  baseOrderNo: string,
  args: Omit<CreateHireOrderWithDatesArgs, "p_order_no">,
): Promise<{ id: string } | { reason: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rpcArgs: CreateHireOrderWithDatesArgs = {
      ...args,
      p_order_no: withCollisionSuffix(baseOrderNo, attempt),
    };
    // The one place the nullable fee/creator have to be re-narrowed: type-gen
    // marks every RPC arg non-null, but the function is CALLED ON NULL INPUT
    // and stores both NULLs verbatim. See CreateHireOrderWithDatesArgs.
    const { data, error } = await admin.rpc(
      "create_hire_order_with_dates",
      rpcArgs as Database["public"]["Functions"][
        "create_hire_order_with_dates"
      ]["Args"],
    );
    if (!error && typeof data === "string") return { id: data };
    if (
      isDateAvailabilityConflict(error) || isActiveArtistDateConflict(error)
    ) {
      return { reason: "exists" };
    }
    if (error && (error as { code?: string }).code === "23505") continue;
    // Surface the REAL Postgres reason instead of an opaque catch-all, so a
    // genuine constraint violation (e.g. a stale check constraint) shows up in
    // the batch response rather than being masked. Mirrors the single-date
    // insertWithRetry, which already returns error.message.
    return {
      reason: (error as { message?: string })?.message ?? "aggregate_insert_failed",
    };
  }
  return { reason: "order_no_collision" };
}

function isDateAvailabilityConflict(error: unknown): boolean {
  const e = error as { message?: string; details?: string } | null;
  return `${e?.message ?? ""} ${e?.details ?? ""}`.includes(
    "active hire order already covers a selected date",
  );
}

// ── agent signature ───────────────────────────────────────────────────────

interface AgentSignatureBody {
  org_id: string;
  signature_png?: string;
}

/**
 * Decode a `data:image/png;base64,...` URL to bytes, or null if the base64 body
 * is undecodable OR the bytes aren't a real PNG (8-byte magic). Shared by the
 * `sign` and agent-signature paths so the decode + magic check live in one place
 * (each caller maps null to its own error code). The `data:...;base64,` prefix and
 * size cap are validated by callers before this.
 */
function decodePngOrNull(dataUrl: string): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(dataUrl.slice(dataUrl.indexOf(",") + 1));
  } catch {
    return null;
  }
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || PNG_SIG.some((b, i) => bytes[i] !== b)) return null;
  return bytes;
}

/**
 * Store the org's booking-agent signature PNG in the hire-orders bucket and
 * return its path + a short-lived signed URL for a settings preview. Admin-only
 * (re-checked by the caller). The path is persisted into hire_order_letterhead by
 * the settings UI's normal save, so this action's ONLY side effect is the bytes
 * (single writer for the setting). Reuses the sign action's PNG validation
 * (prefix + size cap + 8-byte magic).
 */
async function uploadAgentSignature(
  deps: Deps,
  body: AgentSignatureBody,
): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  const png = body.signature_png;
  if (
    typeof png !== "string" ||
    !png.startsWith("data:image/png;base64,") ||
    png.length > MAX_SIGNATURE_PNG_CHARS
  ) {
    return json({ error: "invalid_png" }, 400);
  }
  const bytes = decodePngOrNull(png);
  if (!bytes) return json({ error: "invalid_png" }, 400);
  const path = `${org}/agent-signature.png`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (upErr) return json({ error: "upload_failed" }, 500);
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(
    path,
    SIGNED_URL_TTL,
  );
  return json({ path, url: signed?.signedUrl ?? null });
}

/**
 * Return a short-lived signed URL for the org's already-stored agent signature
 * (or null when none), so the settings card can preview it after a reload — the
 * client can't sign it itself (the bucket has no read policy for this path).
 * Admin-only (re-checked by the caller).
 */
async function agentSignatureUrl(
  deps: Deps,
  body: AgentSignatureBody,
): Promise<Response> {
  const admin = deps.admin;
  const letterhead = await resolveOrgSetting<HireOrderLetterhead>(
    admin,
    body.org_id,
    "hire_order_letterhead",
    LETTERHEAD_DEFAULT,
  );
  const path = letterhead.agent_signature_path;
  if (!path) return json({ url: null });
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(
    path,
    SIGNED_URL_TTL,
  );
  return json({ url: signed?.signedUrl ?? null });
}

/**
 * Download the org's stored agent-signature PNG and return it as a
 * `data:image/png;base64,...` URL for the renderer's producer signature line.
 * Returns null (blank line) when no path is set or the object is missing, so a
 * missing signature never blocks issuing.
 */
async function resolveAgentSignatureDataUrl(
  admin: Deps["admin"],
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try {
    const bytes = new Uint8Array(await (data as Blob).arrayBuffer());
    return `data:image/png;base64,${encodeBase64(bytes)}`;
  } catch {
    return null;
  }
}

// ── issue ────────────────────────────────────────────────────────────────

interface IssueBody {
  org_id: string;
  order_ids: string[];
}

async function issueOrders(
  deps: Deps,
  body: IssueBody,
  _userId: string | null,
): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  const orderIds = Array.isArray(body.order_ids) ? body.order_ids : [];
  if (orderIds.length === 0) return json({ error: "order_ids required" }, 400);

  const [letterhead, rawTerms, defaults, countersign] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(
      admin,
      org,
      "hire_order_letterhead",
      LETTERHEAD_DEFAULT,
    ),
    resolveOrgSetting<unknown>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrderDefaults(admin, org),
    resolveOrgSetting<Countersign>(
      admin,
      org,
      "hire_order_countersign",
      COUNTERSIGN_DEFAULT,
    ),
  ]);
  const termsSetting = normalizeTermsSetting(rawTerms);
  // Resolve the org's editable PDF copy ONCE for the whole batch (frozen per order
  // into issue_snapshot.copy below).
  const copyOverride = await resolveOrgSetting<Partial<HireOrderCopy>>(
    admin,
    org,
    "hire_order_copy",
    COPY_DEFAULT,
  );
  // Per-org language (entitlement-gated), resolved ONCE for the batch and frozen
  // per order into issue_snapshot.locale so a later language/entitlement change
  // never alters an already-issued document's re-render.
  const locale = await resolveOrgLocale(admin, org);
  const copy = resolveHireOrderCopy(copyOverride, locale);
  // Resolve the org's editable PDF theme ONCE for the whole batch (frozen per order
  // into issue_snapshot.theme below), same shape as copy above.
  const themeOverride = await resolveOrgSetting<HireOrderThemeOverride>(
    admin,
    org,
    "hire_order_theme",
    THEME_DEFAULT,
  );
  const theme = resolveHireOrderTheme(themeOverride);
  // Resolve the shared org agent signature ONCE for the whole batch; issueOne runs
  // per order below, so resolving inside it would re-download the same PNG N times.
  const agentSignatureDataUrl = await resolveAgentSignatureDataUrl(
    admin,
    letterhead.agent_signature_path,
  );

  const issued: string[] = [];
  const failed: Array<{ order_id: string; issues: string[] }> = [];

  for (const orderId of orderIds) {
    try {
      const outcome = await issueOne(
        deps,
        org,
        orderId,
        letterhead,
        termsSetting,
        defaults,
        countersign,
        agentSignatureDataUrl,
        copy,
        theme,
        locale,
      );
      if (outcome.ok) {
        issued.push(orderId);
        // A Documenso delivery failure is a WARNING, not an issue failure: the
        // document is genuinely issued (rendered, uploaded, stamped), so it stays
        // in `issued`, and the countersign-delivery problem surfaces alongside it
        // in `failed` rather than silently disappearing.
        if (outcome.warning) {
          failed.push({ order_id: orderId, issues: [outcome.warning] });
        }
      } else {
        failed.push({ order_id: orderId, issues: outcome.issues });
      }
    } catch (e) {
      // Per-order capture: one bad order must not fail the batch.
      console.error("generate-hire-orders: issue failed", {
        org,
        orderId,
        error: (e as Error).message,
      });
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
  termsSetting: HireOrderTermsSetting,
  defaults: OrderDefaults,
  countersign: Countersign,
  agentSignatureDataUrl: string | null,
  copy: HireOrderCopy,
  theme: HireOrderTheme,
  locale: ServerLocale,
): Promise<{ ok: true; warning?: string } | { ok: false; issues: string[] }> {
  const admin = deps.admin;

  const { data: order } = await admin
    .from("hire_orders")
    .select(
      "id, org_id, order_no, status, data, terms_variant, fee_currency, artist_id, agent_name, agent_email",
    )
    .eq("id", orderId)
    .eq("org_id", org)
    .maybeSingle();
  if (!order) return { ok: false, issues: ["not_found"] };
  const o = order as unknown as IssueOrderRow;

  // Idempotency: an already-issued (or countersigned) order is frozen.
  if (o.status === "issued" || o.status === "countersigned") {
    return { ok: false, issues: ["already_issued"] };
  }
  if (o.status === "void") return { ok: false, issues: ["voided"] };

  const data = o.data as OrderData;
  const variantTerms = resolveTermsClauses(termsSetting, o.terms_variant);

  // Readiness gate (four frozen codes) + the terms gate (org must have authored
  // clauses for this variant before it can issue).
  const issues = orderReadyIssues(data, letterhead);
  if (variantTerms.length === 0) issues.push("missing_terms");
  if (issues.length > 0) return { ok: false, issues };

  // Promote a draft to ready before issuing (the transition machine forbids
  // draft -> issued directly). A ready order is issued straight through.
  if (o.status === "draft") {
    const { error } = await admin.from("hire_orders").update({
      status: "ready",
    }).eq("id", orderId);
    if (error) return { ok: false, issues: ["transition_failed"] };
  }

  // Snapshot letterhead carries the small agent_signature_path only. The resolved
  // ~2MB base64 data url is merged in ONLY for the render call below and never
  // frozen into issue_snapshot: that snapshot rides along on every select("*")
  // list/detail fetch, so freezing the blob would duplicate it into every issued
  // order's row and pull it down on every read. signOrder re-resolves it from the
  // frozen path at sign time (matches how the artist's own signature is stored as
  // a path and resolved on demand).
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
    // Resolved once per batch by issueOrders and passed in, so a bulk issue never
    // re-downloads the shared org signature PNG once per order (N+1).
    letterhead: { ...effectiveLetterhead, agent_signature_data_url: agentSignatureDataUrl },
    terms: variantTerms,
    currency,
    generatedAtIso: deps.now().toISOString(),
    copy,
    theme,
    locale,
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
  const snapshot: IssueSnapshot = {
    letterhead: effectiveLetterhead,
    terms: variantTerms,
    currency,
    countersign_mode: countersign.mode,
    copy,
    theme,
    locale,
  };
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
        .update({
          countersign_mode: "documenso",
          documenso_envelope_id: envelope.envelopeId,
        })
        .eq("id", orderId);
      if (csErr) {
        console.error("generate-hire-orders: countersign_mode stamp failed", {
          org,
          orderId,
          error: csErr.message,
        });
      }
    } catch (e) {
      console.error("generate-hire-orders: documenso envelope failed", {
        org,
        orderId,
        error: (e as Error).message,
      });
      countersignModeUsed = "manual";
      warning = "documenso_failed";
      // Explicit fallback write: the order's countersign_mode must read 'manual'
      // even though nothing was ever stamped 'documenso' for it (issue only runs
      // once per order — the already-issued gate above blocks a retry).
      const { error: fallbackErr } = await admin
        .from("hire_orders").update({ countersign_mode: "manual" }).eq(
          "id",
          orderId,
        );
      if (fallbackErr) {
        console.error(
          "generate-hire-orders: countersign fallback stamp failed",
          { org, orderId, error: fallbackErr.message },
        );
      }
    }
  }

  // Electronic (in-app) countersign: nothing to send at issue time — the artist
  // signs later on the order page. Point the issued email's "Review and sign" CTA
  // at that page (the auth-gated detail route, keyed by the order UUID).
  if (countersignModeUsed === "electronic") {
    signingUrl = `${APP_URL}/contracts/${o.id}`;
  }

  // Best-effort side effects — a failure here must NOT undo a successful issue.
  const delivered = await sendIssuedEmail(
    deps,
    org,
    o,
    data,
    bytes,
    currency,
    locale,
    countersignModeUsed,
    signingUrl,
    "issued",
  ).catch((e) => {
    console.error("generate-hire-orders: issued email failed", {
      org,
      orderId,
      error: (e as Error).message,
    });
    return false;
  });
  if (delivered) {
    const { error: sentStampError } = await admin
      .from("hire_orders")
      .update({ last_sent_at: deps.now().toISOString() })
      .eq("id", orderId);
    if (sentStampError) {
      console.error("generate-hire-orders: initial delivery stamp failed", {
        org,
        orderId,
        error: sentStampError.message,
      });
    }
  }
  await notifyArtist(deps, org, o).catch((e) =>
    console.error("generate-hire-orders: artist notification failed", {
      org,
      orderId,
      error: (e as Error).message,
    })
  );

  return warning ? { ok: true, warning } : { ok: true };
}

async function sendIssuedEmail(
  deps: Deps,
  org: string,
  order: EmailOrderRow,
  data: OrderData,
  bytes: Uint8Array,
  currency: string,
  locale: ServerLocale,
  countersignMode: string,
  signingUrl: string | null,
  deliveryKind: "issued" | "resend",
  isFullySigned = false,
  attachmentFilename = `${order.order_no}.pdf`,
): Promise<boolean> {
  const recipient = strField(data, "recipient_email");
  if (!recipient) {
    console.warn(
      "generate-hire-orders: no recipient email, skipping issued email",
      { org, orderId: order.id },
    );
    return false;
  }
  const feeValue = data.fee?.value;
  const feeLabel =
    feeValue === undefined || feeValue === null || feeValue === ""
      ? ""
      : formatMoney(feeValue as string | number, currency, locale === "de" ? "de-DE" : "en-US"); // same fee/currency/locale the PDF shows

  const result = await deps.sendEmail({
    template_name: "hire-order-issued",
    recipient_email: recipient,
    org_id: org,
    // Force the wrapper copy/subject/<html lang> to the same locale that formats
    // the fee (frozen at issue for resend), so the whole email is one language.
    locale,
    // Contract of _shared/transactional-email-templates/hire-order-issued.tsx (snake_case).
    // download_url points at the auth-gated V3 detail page (re-signs the PDF on demand),
    // NOT a raw signed storage URL — a signed URL expires in 3600s and would be dead in the
    // inbox. The route is /contracts/:id, so it uses order.id (the uuid), not order_no.
    // signing_url is set in documenso mode and in electronic mode (the in-app order
    // page). It is undefined, so omitted, for manual mode and for a documenso
    // attempt that failed and fell back -- see issueOne.
    templateData: {
      artist_name: strField(data, "artist_name"),
      order_no: order.order_no,
      date_label: dateLabel(strField(data, "date"), locale),
      engagement_dates_label: engagementDatesLabel(data, locale),
      venue: strField(data, "venue"),
      city: strField(data, "city"),
      fee_label: feeLabel,
      download_url: `${APP_URL}/contracts/${order.id}`,
      countersign_mode: countersignMode,
      signing_url: signingUrl ?? undefined,
      is_fully_signed: isFullySigned,
    },
    attachments: [{
      filename: attachmentFilename,
      content_base64: encodeBase64(bytes),
    }],
    idempotency_key: deliveryKind === "resend"
      ? `hire-order-resend-${order.id}-${deps.now().toISOString()}`
      : `hire-order-issued-${order.id}`,
  });
  if (!emailWasSent(result)) {
    const delivery = result.data as
      | { reason?: unknown }
      | null;
    console.warn("generate-hire-orders: issued email not delivered", {
      org,
      orderId: order.id,
      error: result.error ?? delivery?.reason,
    });
    return false;
  }
  return true;
}

// ── resend ──────────────────────────────────────────────────────────────

interface ResendBody {
  org_id: string;
  order_id: string;
}

type IssuedCountersignMode = "manual" | "documenso" | "electronic";

function isIssuedCountersignMode(
  value: unknown,
): value is IssuedCountersignMode {
  return value === "manual" || value === "documenso" ||
    value === "electronic";
}

function resendSigningDelivery(
  order: ResendOrderRow,
): { countersignMode: IssuedCountersignMode; signingUrl: string | null } {
  const snapshotMode = order.issue_snapshot?.countersign_mode;
  const issuedMode = isIssuedCountersignMode(snapshotMode)
    ? snapshotMode
    : isIssuedCountersignMode(order.countersign_mode)
    ? order.countersign_mode
    : "manual";

  if (issuedMode === "electronic") {
    return {
      countersignMode: "electronic",
      signingUrl: `${APP_URL}/contracts/${order.id}`,
    };
  }

  // A Documenso signing URL needs the recipient token returned at envelope
  // creation. Historical rows retain only documenso_envelope_id, which is not a
  // signing credential and cannot safely be turned into that URL. Until a valid
  // immutable signing URL is persisted, resend those legacy deliveries as manual
  // instead of rendering a misleading "Review and sign" link.
  if (issuedMode === "documenso") {
    return { countersignMode: "manual", signingUrl: null };
  }

  return { countersignMode: "manual", signingUrl: null };
}

async function resendOrder(deps: Deps, body: ResendBody): Promise<Response> {
  const org = body.org_id;
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  const { data: orderRaw, error: orderError } = await deps.admin
    .from("hire_orders")
    .select(
      "id, status, data, order_no, artist_id, pdf_path, signed_pdf_path, fee_currency, countersign_mode, issue_snapshot",
    )
    .eq("id", body.order_id)
    .eq("org_id", org)
    .maybeSingle();
  if (orderError) return json({ error: "order_lookup_failed" }, 500);
  if (!orderRaw) return json({ error: "not_found" }, 404);
  const order = orderRaw as unknown as ResendOrderRow;

  if (order.status !== "issued" && order.status !== "countersigned") {
    return json({ error: "not_issued" }, 409);
  }
  const data = order.data as OrderData;
  if (!strField(data, "recipient_email").trim()) {
    return json({ error: "missing_recipient_email" }, 409);
  }
  const path = order.signed_pdf_path ?? order.pdf_path;
  if (!path) return json({ error: "no_pdf" }, 409);

  const { data: storedPdf, error: downloadError } = await deps.admin.storage
    .from(BUCKET).download(path);
  if (downloadError || !storedPdf) {
    return json({ error: "download_failed" }, 500);
  }
  const bytes = new Uint8Array(await storedPdf.arrayBuffer());
  const currency = order.fee_currency || strField(data, "currency") || "EUR";
  // Replay the locale frozen at issue so the whole resent email (fee text AND the
  // wrapper copy/subject/<html lang> resolved downstream in send-transactional-email)
  // matches the stored PDF even if the org later changed language. Re-gate through
  // resolveOrgLocale so an org that has since lost language_packages falls back to
  // English consistently rather than emitting German fee digits under English copy.
  const resendLocale: ServerLocale = await resolveOrgLocale(
    deps.admin,
    org,
    order.issue_snapshot?.locale ?? "en",
  );
  const signingDelivery = resendSigningDelivery(order);
  const delivered = await sendIssuedEmail(
    deps,
    org,
    order,
    data,
    bytes,
    currency,
    resendLocale,
    signingDelivery.countersignMode,
    signingDelivery.signingUrl,
    "resend",
    order.status === "countersigned",
    path.slice(path.lastIndexOf("/") + 1),
  ).catch((error) => {
    console.error("generate-hire-orders: resend failed", {
      org,
      orderId: order.id,
      error: (error as Error).message,
    });
    return false;
  });
  if (!delivered) return json({ error: "email_failed" }, 502);

  const sentAt = deps.now().toISOString();
  const { error: stampError } = await deps.admin
    .from("hire_orders")
    .update({ last_sent_at: sentAt })
    .eq("id", order.id);
  if (stampError) return json({ error: "stamp_failed" }, 500);
  return json({ sent_at: sentAt });
}

async function notifyArtist(
  deps: Deps,
  org: string,
  order: IssueOrderRow,
): Promise<void> {
  if (!order.artist_id) return;
  const admin = deps.admin;
  // Unlinked artists (no auth user) get no in-app notification.
  const { data: artist } = await admin.from("artists").select("user_id").eq(
    "id",
    order.artist_id,
  ).maybeSingle();
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
  if (error) {
    console.error("generate-hire-orders: artist notification insert failed", {
      org,
      orderId: order.id,
      error: error.message,
    });
  }
}

// ── preview ────────────────────────────────────────────────────────────────

interface PreviewBody {
  org_id: string;
  /** Absent -> a representative sample document (used by the copy settings card,
   *  which previews wording without a specific order). */
  order_id?: string;
  /** Ad-hoc copy overrides layered over the org's stored copy, so the settings
   *  card can preview unsaved edits. */
  copy_override?: Partial<HireOrderCopy>;
  /** Ad-hoc theme overrides layered over the org's stored theme, so the editor
   *  can preview unsaved edits. */
  theme_override?: HireOrderThemeOverride;
}

async function previewOrder(deps: Deps, body: PreviewBody): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;

  // Resolve the org's stored copy/theme, then layer any ad-hoc override on top
  // (override wins) so the settings-card / editor preview reflects unsaved edits.
  const [letterhead, rawTerms, defaults, storedCopy, storedTheme] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(
      admin,
      org,
      "hire_order_letterhead",
      LETTERHEAD_DEFAULT,
    ),
    resolveOrgSetting<unknown>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrderDefaults(admin, org),
    resolveOrgSetting<Partial<HireOrderCopy>>(
      admin,
      org,
      "hire_order_copy",
      COPY_DEFAULT,
    ),
    resolveOrgSetting<HireOrderThemeOverride>(
      admin,
      org,
      "hire_order_theme",
      THEME_DEFAULT,
    ),
  ]);
  // Preview reflects the org's CURRENT language (live, entitlement-gated), unlike
  // issue/countersign which use the frozen snapshot locale.
  const locale = await resolveOrgLocale(admin, org);
  const copy = resolveHireOrderCopy({ ...storedCopy, ...(body.copy_override ?? {}) }, locale);
  const theme = resolveHireOrderTheme(layerThemeOverride(storedTheme, body.theme_override));
  const termsSetting = normalizeTermsSetting(rawTerms);

  // With no order_id, render a representative sample (copy settings preview);
  // otherwise preview the specific order.
  let o: PreviewOrderRow;
  if (body.order_id) {
    const { data: order } = await admin
      .from("hire_orders")
      .select(
        "id, org_id, order_no, data, terms_variant, fee_currency, agent_name, agent_email",
      )
      .eq("id", body.order_id)
      .eq("org_id", org)
      .maybeSingle();
    if (!order) return json({ error: "not_found" }, 404);
    o = order as unknown as PreviewOrderRow;
  } else {
    o = {
      id: "",
      org_id: org,
      order_no: SAMPLE_ORDER_NO,
      data: sampleOrderData(),
      terms_variant: null,
      fee_currency: null,
      agent_name: null,
      agent_email: null,
    };
  }
  const isSample = !body.order_id;

  const effectiveLetterhead: HireOrderLetterhead = {
    ...letterhead,
    agent_name: o.agent_name ?? letterhead.agent_name,
    agent_email: o.agent_email ?? letterhead.agent_email,
    agent_signature_data_url: await resolveAgentSignatureDataUrl(
      admin,
      letterhead.agent_signature_path,
    ),
  };
  const clauses = resolveTermsClauses(termsSetting, o.terms_variant);
  // The sample path is what the template editor's "Open exact PDF" opens, so
  // it goes through the SAME shared composer the editor's live browser
  // preview uses (sampleRenderInput): same signature, same engagement dates,
  // same fee basis, and the same fixture fallback for an org that has
  // authored no letterhead or terms. A real order (order_id present) never
  // borrows those fixtures.
  const bytes = await deps.renderHireOrderPdf(
    isSample
      ? sampleRenderInput({
        copy,
        theme,
        locale,
        letterhead: effectiveLetterhead,
        terms: clauses,
        currency: o.fee_currency ?? defaults.currency ?? "EUR",
        generatedAtIso: deps.now().toISOString(),
      })
      : {
        data: o.data as OrderData,
        orderNo: o.order_no,
        status: "preview",
        letterhead: effectiveLetterhead,
        terms: clauses,
        currency: o.fee_currency ?? defaults.currency ?? "EUR",
        generatedAtIso: deps.now().toISOString(),
        copy,
        theme,
        locale,
      },
  );

  return json({ pdf_base64: encodeBase64(bytes) });
}

// ── download-url (own auth: producers + linked artist) ─────────────────────

interface DownloadBody {
  org_id: string;
  order_id: string;
}

async function downloadUrl(
  deps: Deps,
  req: Request,
  body: DownloadBody,
): Promise<Response> {
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  // Any authenticated user; authorization is decided against the loaded order below.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userClient = deps.userClient(authHeader);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const admin = deps.admin;
  const { data: order } = await admin
    .from("hire_orders")
    .select(
      "id, org_id, artist_id, status, pdf_path, signed_pdf_path, order_no",
    )
    .eq("id", body.order_id)
    .eq("org_id", body.org_id)
    .maybeSingle();
  if (!order) return json({ error: "not_found" }, 404);
  const o = order as unknown as DownloadOrderRow;

  let allowed = false;

  // 1) Admin/producer of the order's org.
  const { data: roleRow } = await admin
    .from("org_memberships").select("role")
    .eq("user_id", user.id).eq("org_id", o.org_id).in("role", [
      "admin",
      "producer",
    ]).limit(1).maybeSingle();
  if (roleRow) allowed = true;

  // 2) Super-admin (god mode).
  if (!allowed) {
    const { data: superRow } = await admin.from("platform_admins").select(
      "user_id",
    ).eq("user_id", user.id).maybeSingle();
    if (superRow) allowed = true;
  }

  // 3) The linked artist, on an issued/countersigned order only.
  if (
    !allowed && o.artist_id &&
    (o.status === "issued" || o.status === "countersigned")
  ) {
    const { data: artistRow } = await admin
      .from("artists").select("id").eq("id", o.artist_id).eq("user_id", user.id)
      .maybeSingle();
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

  return json({
    url: (signed as { signedUrl: string }).signedUrl,
    expires_in: SIGNED_URL_TTL,
  });
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
  show_dates: {
    city_id: string | null;
    shows: { program: string | null; sub_program: string | null } | null;
  } | null;
}

const CONSENT_TEXT =
  "By signing, I agree that my electronic signature is the legal equivalent of my handwritten signature, and I accept the terms of this hire order.";
const MAX_SIGNATURE_PNG_CHARS = 2_000_000; // ~1.5MB decoded — a generous cap for a canvas PNG

async function signOrder(
  deps: Deps,
  req: Request,
  body: SignBody,
): Promise<Response> {
  const admin = deps.admin;
  const org = body.org_id;
  if (!body.order_id) return json({ error: "order_id required" }, 400);

  // Own auth: any authenticated user; authorization decided against the loaded order.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const { data: { user }, error: authErr } = await deps.userClient(authHeader)
    .auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: orderRaw } = await admin
    .from("hire_orders")
    .select(
      "id, org_id, order_no, status, artist_id, terms_variant, fee_currency, agent_name, agent_email, issued_pdf_sha256, issue_snapshot, data, show_date_id, show_dates(city_id, shows(program, sub_program))",
    )
    .eq("id", body.order_id)
    .eq("org_id", org)
    .maybeSingle();
  if (!orderRaw) return json({ error: "not_found" }, 404);
  const o = orderRaw as unknown as SignOrderRow;

  // Only the linked artist may sign.
  if (!o.artist_id) return json({ error: "forbidden" }, 403);
  const { data: artistRow } = await admin
    .from("artists").select("id").eq("id", o.artist_id).eq("user_id", user.id)
    .maybeSingle();
  if (!artistRow) return json({ error: "forbidden" }, 403);

  // Idempotency + status guard.
  if (o.status === "countersigned") {
    return json({ countersigned: true, idempotent: true });
  }
  if (o.status !== "issued") return json({ error: "not_issued" }, 409);

  // Feature + mode gate.
  const denied = await requireFeature(deps, org, "hire_orders");
  if (denied) return denied;
  const countersign = await resolveOrgSetting<Countersign>(
    admin,
    org,
    "hire_order_countersign",
    COUNTERSIGN_DEFAULT,
  );
  // Prefer the mode the order was ISSUED under (frozen in the snapshot) over the live
  // org setting, so switching the org electronic->manual mid-flight cannot strand an
  // electronic-issued order (the DB gate keys off the same frozen mode). Legacy/null
  // snapshots fall back to the current setting.
  const effectiveMode = o.issue_snapshot?.countersign_mode ?? countersign.mode;
  if (effectiveMode !== "electronic") return json({ error: "wrong_mode" }, 409);

  // Consent + payload validation.
  if (body.consent !== true) return json({ error: "consent_required" }, 400);
  const method = body.method;
  if (method !== "typed" && method !== "drawn") {
    return json({ error: "invalid_signature" }, 400);
  }
  const typedName = (body.typed_name ?? "").trim();
  if (method === "typed" && typedName === "") {
    return json({ error: "invalid_signature" }, 400);
  }
  const png = body.signature_png ?? "";
  if (
    method === "drawn" &&
    (!png.startsWith("data:image/png;base64,") ||
      png.length > MAX_SIGNATURE_PNG_CHARS)
  ) {
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
    // Decode + verify the 8-byte PNG magic before it reaches storage / the react-pdf
    // <Image> renderer (an undecodable or non-PNG body would otherwise throw uncaught
    // -> CORS-less 500). Same clean 400 the other payload-validation failures return.
    const pngBytes = decodePngOrNull(png);
    if (!pngBytes) return json({ error: "invalid_signature" }, 400);
    signatureImagePath = `${org}/signatures/${o.order_no}.png`;
    const { error: imgErr } = await admin.storage.from(BUCKET).upload(
      signatureImagePath,
      pngBytes,
      {
        contentType: "image/png",
        upsert: true,
      },
    );
    if (imgErr) return json({ error: "signature_upload_failed" }, 500);
  }

  // Re-render the signed PDF from the frozen issue snapshot so it reproduces the
  // exact issued document the certificate hash attests to (finding W1). Legacy
  // orders issued before the issue_snapshot column carry null and fall back to
  // re-resolving the org's CURRENT letterhead/terms + the per-order agent override.
  const [letterhead, rawTerms, defaults] = await Promise.all([
    resolveOrgSetting<HireOrderLetterhead>(
      admin,
      org,
      "hire_order_letterhead",
      LETTERHEAD_DEFAULT,
    ),
    resolveOrgSetting<unknown>(admin, org, "hire_order_terms", TERMS_DEFAULT),
    resolveOrderDefaults(admin, org),
  ]);
  const snapshot = o.issue_snapshot;
  let renderLetterhead: HireOrderLetterhead;
  let renderTerms: HireOrderTerm[];
  let currency: string;
  let renderCopy: HireOrderCopy;
  let renderTheme: HireOrderTheme;
  // Language frozen at issue (weekday + money), so a countersigned re-render matches
  // the issued PDF even if the org later switched language. Legacy/no-snapshot
  // orders predate German and reproduce as English.
  let renderLocale: ServerLocale;
  if (snapshot && snapshot.letterhead && Array.isArray(snapshot.terms)) {
    // The snapshot letterhead already includes the per-order agent override baked in
    // at issue time, so do NOT re-merge o.agent_name/agent_email here.
    renderLetterhead = snapshot.letterhead;
    renderTerms = snapshot.terms;
    currency = snapshot.currency ?? o.fee_currency ?? defaults.currency ??
      "EUR";
    // Reproduce the issued wording. snapshot.copy is a full record for part-E
    // orders and undefined for legacy ones; resolveHireOrderCopy fills any gaps
    // from the current defaults either way.
    renderCopy = resolveHireOrderCopy(snapshot.copy);
    // Reproduce the issued typography/colour. snapshot.theme is a full resolved
    // theme for orders issued after this change and undefined for older ones;
    // resolveHireOrderTheme fills any gaps from the built-in defaults either way.
    renderTheme = resolveHireOrderTheme(snapshot.theme);
    // Replay the frozen locale, but STILL through the entitlement gate: an org that
    // has since lost language_packages re-renders the signed doc in English rather
    // than bypassing the gate off the raw snapshot value.
    renderLocale = await resolveOrgLocale(admin, org, snapshot.locale ?? "en");
  } else {
    const termsSetting = normalizeTermsSetting(rawTerms);
    renderLetterhead = {
      ...letterhead,
      agent_name: o.agent_name ?? letterhead.agent_name,
      agent_email: o.agent_email ?? letterhead.agent_email,
    };
    renderTerms = resolveTermsClauses(termsSetting, o.terms_variant);
    currency = o.fee_currency ?? defaults.currency ?? "EUR";
    // No snapshot (legacy order): re-resolve the org's current copy/theme setting.
    const storedCopy = await resolveOrgSetting<Partial<HireOrderCopy>>(
      admin,
      org,
      "hire_order_copy",
      COPY_DEFAULT,
    );
    renderCopy = resolveHireOrderCopy(storedCopy);
    renderLocale = "en";
    const storedTheme = await resolveOrgSetting<HireOrderThemeOverride>(
      admin,
      org,
      "hire_order_theme",
      THEME_DEFAULT,
    );
    renderTheme = resolveHireOrderTheme(storedTheme);
  }
  // The snapshot/live letterhead carries only agent_signature_path (never the base64
  // blob, see issueOne). Resolve the data url fresh so the signed re-render still draws
  // the org agent signature. A missing path (legacy/no signature) resolves to null.
  renderLetterhead = {
    ...renderLetterhead,
    agent_signature_data_url: await resolveAgentSignatureDataUrl(
      admin,
      renderLetterhead.agent_signature_path,
    ),
  };
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
    data,
    orderNo: o.order_no,
    status: "countersigned",
    letterhead: renderLetterhead,
    terms: renderTerms,
    currency,
    generatedAtIso: signedAtIso,
    signature,
    copy: renderCopy,
    theme: renderTheme,
    locale: renderLocale,
  });

  // Upload the signed copy (keeps the original issued pdf_path intact).
  const signedPath = `${org}/${o.order_no}-signed.pdf`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(
    signedPath,
    signedBytes,
    {
      contentType: "application/pdf",
      upsert: true,
    },
  );
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
  if (sigErr && (sigErr as { code?: string }).code !== "23505") {
    return json({ error: "signature_insert_failed" }, 500);
  }

  // Atomic + idempotent transition (guarded by status='issued').
  const { data: updatedRows, error: updErr } = await admin
    .from("hire_orders")
    .update({
      status: "countersigned",
      countersigned_at: signedAtIso,
      signed_pdf_path: signedPath,
      countersign_mode: "electronic",
    })
    .eq("id", o.id)
    .eq("status", "issued")
    .select("id");
  if (updErr) return json({ error: "transition_failed" }, 500);
  const affected = Array.isArray(updatedRows)
    ? updatedRows.length > 0
    : !!updatedRows;
  if (!affected) return json({ countersigned: true, idempotent: true });

  // Best-effort side effects — never undo a completed signing.
  await notifyProducersCountersigned(deps, o).catch((e) =>
    console.error("generate-hire-orders: sign producer notify failed", {
      org,
      orderId: o.id,
      error: (e as Error).message,
    })
  );
  await notifyArtistCountersigned(deps, org, o, user.id).catch((e) =>
    console.error("generate-hire-orders: sign artist notify failed", {
      org,
      orderId: o.id,
      error: (e as Error).message,
    })
  );
  await sendCountersignedEmails(
    deps,
    org,
    o,
    data,
    signedBytes,
    currency,
    !!countersign.email_producers_on_countersign,
    renderLocale,
  ).catch((e) =>
    console.error("generate-hire-orders: countersigned email failed", {
      org,
      orderId: o.id,
      error: (e as Error).message,
    })
  );

  return json({ countersigned: true, signed_pdf_path: signedPath });
}

/** Notify the order's producers that the artist countersigned (in-app). Mirrors
 *  documenso-webhook's notifyProducers resolution: resolve_show_assignments on the
 *  order's show_date, falling back to org admins; deduped. */
async function notifyProducersCountersigned(
  deps: Deps,
  order: SignOrderRow,
): Promise<void> {
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
    recipientIds = ((producers ?? []) as unknown as ProducerAssignmentRow[])
      .map((p) => p.producer_user_id);
  }
  if (recipientIds.length === 0) {
    const { data: admins } = await admin.from("org_memberships").select(
      "user_id",
    ).eq("org_id", org).eq("role", "admin");
    recipientIds = ((admins ?? []) as unknown as OrgAdminRow[]).map((a) =>
      a.user_id
    );
  }
  recipientIds = [...new Set(recipientIds)] as string[];
  if (recipientIds.length === 0) return;
  const rows = recipientIds.map((uid) => ({
    org_id: org,
    user_id: uid,
    type: "hire_order_countersigned",
    title: "Hire order countersigned",
    message: `Hire order ${order.order_no} has been countersigned.`,
    related_entity_type: "hire_order",
    related_entity_id: order.id,
  }));
  await admin.from("notifications").insert(rows);
}

/** A confirmation notification for the signing artist. */
async function notifyArtistCountersigned(
  deps: Deps,
  org: string,
  order: SignOrderRow,
  userId: string,
): Promise<void> {
  await deps.admin.from("notifications").insert([{
    org_id: org,
    user_id: userId,
    type: "hire_order_countersigned",
    title: "Hire order signed",
    message: `You signed hire order ${order.order_no}.`,
    related_entity_type: "hire_order",
    related_entity_id: order.id,
  }]);
}

/** Email the artist the signed PDF; optionally email producers too (opt-in flag). */
async function sendCountersignedEmails(
  deps: Deps,
  org: string,
  order: SignOrderRow,
  data: OrderData,
  signedBytes: Uint8Array,
  _currency: string,
  emailProducers: boolean,
  locale: ServerLocale,
): Promise<void> {
  const attachment = {
    filename: `${order.order_no}-signed.pdf`,
    content_base64: encodeBase64(signedBytes),
  };
  const templateData = {
    artist_name: strField(data, "artist_name"),
    order_no: order.order_no,
    date_label: dateLabel(strField(data, "date"), locale),
    venue: strField(data, "venue"),
    download_url: `${APP_URL}/contracts/${order.id}`,
  };
  const artistEmail = strField(data, "recipient_email");
  if (artistEmail) {
    await deps.sendEmail({
      template_name: "hire-order-countersigned",
      recipient_email: artistEmail,
      org_id: org,
      // Match the frozen, entitlement-gated locale the signed PDF was rendered in,
      // instead of re-resolving the org's live language at send time.
      locale,
      templateData,
      attachments: [attachment],
      idempotency_key: `hire-order-countersigned-${order.id}`,
    });
  }
  if (!emailProducers) return;
  // Resolve producer emails via auth admin (few per show); best-effort.
  let producerIds: string[] = [];
  if (order.show_dates) {
    const { data: producers } = await deps.admin.rpc(
      "resolve_show_assignments",
      {
        p_program: order.show_dates.shows?.program ?? "",
        p_sub_program: order.show_dates.shows?.sub_program ?? null,
        p_city_id: order.show_dates.city_id,
        p_org: org,
      } as ResolveShowAssignmentsArgs,
    );
    producerIds = ((producers ?? []) as unknown as ProducerAssignmentRow[]).map(
      (p) => p.producer_user_id,
    );
  }
  for (const uid of [...new Set(producerIds)]) {
    const { data: got } = await deps.admin.auth.admin.getUserById(uid);
    const email = (got as { user?: { email?: string } } | null)?.user?.email;
    if (!email) continue;
    await deps.sendEmail({
      template_name: "hire-order-countersigned",
      recipient_email: email,
      org_id: org,
      templateData: {
        ...templateData,
        _intro: `A hire order for ${
          templateData.venue || "a show"
        } has been countersigned by the artist. The signed copy is attached.`,
      },
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
  if (!token) {
    return json({
      ok: false,
      detail: "Documenso API token is not configured on the server",
    });
  }

  const baseUrlResult = resolveDocumensoBaseUrl(deps);
  if (!baseUrlResult.ok) {
    return json({ ok: false, detail: baseUrlResult.error });
  }
  try {
    const res = await deps.fetch(
      `${baseUrlResult.baseUrl}/api/v2/envelope?perPage=1`,
      {
        headers: { Authorization: documensoAuthHeader(token) },
      },
    );
    if (!res.ok) {
      return json({ ok: false, detail: `documenso_error:${res.status}` });
    }
    return json({ ok: true, detail: "Connected" });
  } catch (e) {
    return json({ ok: false, detail: (e as Error).message });
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Assign a layer field only when the value is meaningful (skip null/undefined/""). */
function assign(
  layer: Partial<Record<OrderFieldKey, unknown>>,
  key: OrderFieldKey,
  value: unknown,
): void {
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
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
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
function dateLabel(dateOnly: string, locale: ServerLocale = "en"): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateOnly)) return dateOnly;
  const d = new Date(`${dateOnly.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateOnly;
  return d.toLocaleDateString(locale === "de" ? "de-DE" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Human-readable complete schedule for aggregate hire-order delivery emails. */
function engagementDatesLabel(data: OrderData, locale: ServerLocale = "en"): string {
  const dates = data.engagement_dates?.value;
  if (!Array.isArray(dates) || dates.length === 0) {
    return dateLabel(strField(data, "date"), locale);
  }
  return dates.map((engagement) => {
    const location = [engagement.venue, engagement.city]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(", ");
    return [dateLabel(engagement.date, locale), location].filter(Boolean).join(" · ");
  }).join("; ");
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
