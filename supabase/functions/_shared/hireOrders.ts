// Hire order pure logic — field resolution, order numbers, money formatting,
// readiness validation. MIRROR: src/lib/hireOrders/{types,resolveFields,
// orderNo,money,validate}.ts carries the same types + logic split across
// files (the two runtimes cannot share an import); this file combines them
// into one per edge convention (see src/lib/entitlements.ts /
// _shared/entitlements.ts for the house precedent of this pattern). Change
// both homes in the same commit.
//
// EXCEPTION: the renderer port at the bottom of this file is edge-only and
// has no src/ twin — see the comment there.

export type FieldSource = "showflow" | "sheet" | "manual" | "default";

export interface FieldValue<T = unknown> {
  value: T;
  source: FieldSource;
}

export interface EngagementDate {
  show_date_id: string;
  date: string;
  venue: string | null;
  city: string | null;
}

export type OrderFieldKey =
  | "artist_name"
  | "recipient_email"
  | "role"
  | "cast"
  | "date"
  | "venue"
  | "city"
  | "duration_min"
  | "sessions"
  | "fee"
  | "currency"
  | "notes"
  | "engagement_dates";

export type EditableOrderFieldKey = Exclude<OrderFieldKey, "engagement_dates">;

/** Fixed iteration order for resolveFields and any UI that lists order fields. */
export const ORDER_FIELD_KEYS: EditableOrderFieldKey[] = [
  "artist_name",
  "recipient_email",
  "role",
  "cast",
  "date",
  "venue",
  "city",
  "duration_min",
  "sessions",
  "fee",
  "currency",
  "notes",
];

export type OrderData =
  & Partial<Record<OrderFieldKey, FieldValue>>
  & { engagement_dates?: FieldValue<EngagementDate[]> };

export interface FieldLayers {
  showflow?: Partial<Record<EditableOrderFieldKey, unknown>>;
  sheet?: Partial<Record<EditableOrderFieldKey, unknown>>;
  manual?: Partial<Record<EditableOrderFieldKey, unknown>>;
  defaults?: Partial<Record<EditableOrderFieldKey, unknown>>;
}

// ── resolveFields ────────────────────────────────────────────────────────

/** Precedence order, highest first: manual > sheet > showflow > default. */
const LAYER_PRECEDENCE: Array<{ layer: keyof FieldLayers; source: FieldSource }> = [
  { layer: "manual", source: "manual" },
  { layer: "sheet", source: "sheet" },
  { layer: "showflow", source: "showflow" },
  { layer: "defaults", source: "default" },
];

/**
 * Resolve each order field to the highest-precedence layer that has a
 * non-empty value, tagging it with which layer it came from. `undefined`
 * and `""` values are treated as absent and skipped.
 */
export function resolveFields(layers: FieldLayers): OrderData {
  const out: OrderData = {};
  for (const key of ORDER_FIELD_KEYS) {
    for (const { layer, source } of LAYER_PRECEDENCE) {
      const value = layers[layer]?.[key];
      if (value === undefined || value === "") continue;
      out[key] = { value, source };
      break;
    }
  }
  return out;
}

// ── orderNo ──────────────────────────────────────────────────────────────

/**
 * Render an order-number pattern. Supported tokens: {prefix}, {yyyy}, {mm},
 * {dd}, {mmdd}, {seq} (per-artist sequence, always numeric), {cast} (cast code
 * when present, else ""), and {cast|seq} (cast code when present, else seq — the
 * legacy token, kept for orgs that configured it).
 *
 * The default pattern uses {seq} so every artist on a date gets a DISTINCT base
 * number; {cast|seq} collapsed a whole cast to one base, leaving the collision
 * suffix as the only differentiator.
 *
 * `date` arrives as a `YYYY-MM-DD` string; sliced directly (no Date parsing)
 * to avoid timezone drift.
 */
export function formatOrderNo(
  pattern: string,
  parts: { prefix: string; date?: string; castCode?: string; seq: number },
): string {
  const { prefix, date, castCode, seq } = parts;
  const yyyy = date ? date.slice(0, 4) : "";
  const mm = date ? date.slice(5, 7) : "";
  const dd = date ? date.slice(8, 10) : "";
  const mmdd = `${mm}${dd}`;
  const castOrSeq = castCode ?? String(seq);

  return pattern
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{mmdd\}/g, mmdd)
    .replace(/\{mm\}/g, mm)
    .replace(/\{dd\}/g, dd)
    // {cast|seq} first: it contains the substrings "cast" and "seq" but must be
    // replaced as a whole before the standalone {cast}/{seq} tokens are matched.
    .replace(/\{cast\|seq\}/g, castOrSeq)
    .replace(/\{cast\}/g, castCode ?? "")
    .replace(/\{seq\}/g, String(seq));
}

/**
 * Append a collision suffix for retrying a colliding order number.
 * attempt 0 => unchanged, 1 => "-2", 2 => "-3" (attempt N => suffix N+1).
 */
export function withCollisionSuffix(orderNo: string, attempt: number): string {
  if (attempt <= 0) return orderNo;
  return `${orderNo}-${attempt + 1}`;
}

// ── money ────────────────────────────────────────────────────────────────

/** Currency symbol prefix. CHF's trailing space is by design — preserve it. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  CHF: "CHF ",
};

/**
 * Format an amount for display with a currency symbol, two decimals, and
 * thousands separators (e.g. "€4,500.00"). Formats only — the amount is
 * parsed for display purposes, never used in arithmetic; storage stays
 * `numeric(10,2)` in SQL.
 */
export function formatMoney(amount: string | number, currency: string): string {
  const numeric = typeof amount === "string" ? Number(amount) : amount;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${formatted}`;
}

// ── validate ─────────────────────────────────────────────────────────────

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * A hire order is ready to issue once it has a fee, a recipient email, a
 * date, and the org's letterhead has a legal name. Returns [] when ready.
 * Returns string codes only, never copy — the UI translates codes to text.
 */
export function orderReadyIssues(data: OrderData, letterhead: unknown): string[] {
  const issues: string[] = [];
  if (isBlank(data.fee?.value)) issues.push("missing_fee");
  if (isBlank(data.recipient_email?.value)) issues.push("missing_recipient_email");
  if (isBlank(data.date?.value)) issues.push("missing_date");
  const legalName = (letterhead as { legal_name?: unknown } | null | undefined)?.legal_name;
  if (isBlank(legalName)) issues.push("missing_letterhead");
  return issues;
}

// ── terms ────────────────────────────────────────────────────────────────
// MIRROR: src/lib/hireOrders/terms.ts carries a byte-identical copy of these
// types + helpers (the two runtimes cannot share an import). Change both
// files in the same commit. `HireOrderClause` aliases `HireOrderTerm` below
// (declared in the renderer port section) rather than duplicating it.

export type HireOrderClause = HireOrderTerm;

export interface HireOrderTemplate {
  id: string;
  name: string;
  clauses: HireOrderClause[];
}

export interface HireOrderTermsSetting {
  templates: HireOrderTemplate[];
  default_id: string | null;
}

const LEGACY_TERMS_KEYS = ["lean", "standard", "full"] as const;
const LEGACY_TERMS_NAMES: Record<(typeof LEGACY_TERMS_KEYS)[number], string> = {
  lean: "Lean",
  standard: "Standard",
  full: "Full",
};

function isTermsRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceTermsClauses(raw: unknown): HireOrderClause[] {
  if (!Array.isArray(raw)) return [];
  const out: HireOrderClause[] = [];
  for (const c of raw) {
    if (isTermsRecord(c) && typeof c.title === "string" && typeof c.body === "string") {
      out.push({ title: c.title, body: c.body });
    }
  }
  return out;
}

/** Normalize any stored `hire_order_terms` value to the new shape, tolerating
 *  the legacy `{lean,standard,full}` shape and junk. */
export function normalizeTermsSetting(raw: unknown): HireOrderTermsSetting {
  if (!isTermsRecord(raw)) return { templates: [], default_id: null };

  // Legacy shape: has at least one of lean/standard/full and no `templates`.
  if (!("templates" in raw) && LEGACY_TERMS_KEYS.some((k) => k in raw)) {
    return {
      templates: LEGACY_TERMS_KEYS.map((k) => ({
        id: k,
        name: LEGACY_TERMS_NAMES[k],
        clauses: coerceTermsClauses(raw[k]),
      })),
      default_id: "standard",
    };
  }

  if (!Array.isArray(raw.templates)) return { templates: [], default_id: null };
  const templates: HireOrderTemplate[] = [];
  for (const t of raw.templates) {
    if (isTermsRecord(t) && typeof t.id === "string" && typeof t.name === "string") {
      templates.push({ id: t.id, name: t.name, clauses: coerceTermsClauses(t.clauses) });
    }
  }
  const default_id = typeof raw.default_id === "string" ? raw.default_id : null;
  return { templates, default_id };
}

/** The effective default template id: `default_id` if it exists, else the first
 *  template, else null. */
export function defaultTemplateId(setting: HireOrderTermsSetting): string | null {
  if (setting.default_id && setting.templates.some((t) => t.id === setting.default_id)) {
    return setting.default_id;
  }
  return setting.templates[0]?.id ?? null;
}

/** Clauses to render for an order: the referenced template, else the default
 *  template (deleted-reference fallback), else []. */
export function resolveTermsClauses(
  setting: HireOrderTermsSetting,
  termsVariantId: string | null,
): HireOrderClause[] {
  const byId = termsVariantId
    ? setting.templates.find((t) => t.id === termsVariantId)
    : undefined;
  if (byId) return byId.clauses;
  const defId = defaultTemplateId(setting);
  return setting.templates.find((t) => t.id === defId)?.clauses ?? [];
}

// ── renderer port ────────────────────────────────────────────────────────
//
// Edge-only, deliberately NOT mirrored in src/lib/hireOrders/: the frontend
// never renders PDFs (it previews and downloads what the edge function
// produced), so there is nothing for a browser-side twin to implement.
//
// The port exists so the generate-hire-orders function can inject the
// renderer through `Deps` and be tested without paying for a real render.
// The concrete implementation is `./hire-order-pdf/render.tsx`.

export interface HireOrderLetterhead {
  legal_name: string;
  address_lines: string[];
  registration_line?: string;
  agent_name?: string;
  agent_email?: string;
}

export interface HireOrderTerm {
  title: string;
  body: string;
}

export interface RenderInput {
  /** The order's field snapshot, already resolved by `resolveFields`. */
  data: OrderData;
  orderNo: string;
  /** `preview` overlays a watermark; `issued` is the document of record;
   *  `countersigned` renders the artist's signature + a certificate page. */
  status: "issued" | "preview" | "countersigned";
  letterhead: HireOrderLetterhead;
  /** The org's terms. Empty is the seeded default — the section is omitted. */
  terms: HireOrderTerm[];
  /** Currency code for `formatMoney` (e.g. "EUR"). */
  currency: string;
  /** Timestamp shown in the footer; rendered as a UTC calendar date. */
  generatedAtIso: string;
  /** Present only for a countersigned render — draws the artist's mark on the
   *  signature line and appends the signature-certificate page. */
  signature?: RenderSignature;
}

/** Audit + mark data for a countersigned render. */
export interface RenderSignature {
  method: "typed" | "drawn";
  /** Typed full name (method 'typed'). */
  typedName?: string;
  /** `data:image/png;base64,...` (method 'drawn'). */
  imageDataUrl?: string;
  signerName: string;
  signerEmail?: string;
  signedAtIso: string;
  ip?: string;
  userAgent?: string;
  documentSha256: string;
  consentText: string;
}

export type RenderHireOrderPdf = (input: RenderInput) => Promise<Uint8Array>;
