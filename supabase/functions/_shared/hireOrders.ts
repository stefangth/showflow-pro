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
  | "notes";

/** Fixed iteration order for resolveFields and any UI that lists order fields. */
export const ORDER_FIELD_KEYS: OrderFieldKey[] = [
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

export type OrderData = Partial<Record<OrderFieldKey, FieldValue>>;

export interface FieldLayers {
  showflow?: Partial<Record<OrderFieldKey, unknown>>;
  sheet?: Partial<Record<OrderFieldKey, unknown>>;
  manual?: Partial<Record<OrderFieldKey, unknown>>;
  defaults?: Partial<Record<OrderFieldKey, unknown>>;
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
 * {dd}, {mmdd}, {cast|seq} (castCode when present, else seq).
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
    .replace(/\{cast\|seq\}/g, castOrSeq);
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
  /** `preview` overlays a watermark; `issued` is the document of record. */
  status: "issued" | "preview";
  letterhead: HireOrderLetterhead;
  /** The org's terms. Empty is the seeded default — the section is omitted. */
  terms: HireOrderTerm[];
  /** Currency code for `formatMoney` (e.g. "EUR"). */
  currency: string;
  /** Timestamp shown in the footer; rendered as a UTC calendar date. */
  generatedAtIso: string;
}

export type RenderHireOrderPdf = (input: RenderInput) => Promise<Uint8Array>;
