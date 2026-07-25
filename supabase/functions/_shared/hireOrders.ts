// Hire order pure logic — field resolution, order numbers, money formatting,
// readiness validation. MIRROR: src/lib/hireOrders/{resolveFields,orderNo,
// validate}.ts carries the same logic split across files (the two runtimes
// cannot share an import); this file combines them into one per edge
// convention (see src/lib/entitlements.ts / _shared/entitlements.ts for the
// house precedent of this pattern). Change both homes in the same commit.
//
// The domain types (OrderData, RenderInput, etc) and money formatting used to
// be declared inline here too, some of them commented "edge-only". Both
// stopped being true: render.tsx is now dual-homed for the browser preview,
// so those live in ./hire-order-pdf/docTypes.ts and ./money.ts respectively
// (each a generated mirror of a src/lib/hireOrders source) and are
// re-exported below rather than redeclared, so every existing import from
// this module keeps resolving unchanged.

import {
  type FieldLayers,
  type FieldSource,
  type HireOrderTerm,
  ORDER_FIELD_KEYS,
  type OrderData,
  type RenderInput,
} from "./hire-order-pdf/docTypes.ts";

export * from "./hire-order-pdf/docTypes.ts";

// ── engagementDates ──────────────────────────────────────────────────────
// MIRROR: src/lib/hireOrders/engagementDates.ts carries a byte-identical
// copy of this type + function (the two runtimes cannot share an import).
// Change both files in the same commit.

export interface SessionOverride {
  sessions?: string[];
  duration_min?: number | null;
}

/** Merge a show_date's synced running order with an optional wizard override.
 *  `sessions`/`duration_min` are each overridden only when present on the
 *  override (an empty `sessions` array is an explicit clear, not "absent"). */
export function resolveEngagementSessions(
  synced: { sessions: string[]; duration_min: number | null },
  override: SessionOverride | undefined,
): { sessions: string[]; duration_min: number | null } {
  return {
    sessions: override && override.sessions !== undefined ? override.sessions : synced.sessions,
    duration_min: override && override.duration_min !== undefined ? override.duration_min : synced.duration_min,
  };
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
// Re-exported from the generated mirror of src/lib/hireOrders/money.ts, so
// callers keep importing everything hire-order from this one module.
export { formatMoney } from "./money.ts";

// ── fee basis ────────────────────────────────────────────────────────────
// Re-exported from the generated mirror of src/lib/hireOrders/feeBasis.ts, so
// callers keep importing everything hire-order from this one module.
export {
  computeFeeTotal,
  feeBreakdownReconciles,
  feeCents,
  type FeeBasis,
  isFeeBasis,
} from "./feeBasis.ts";

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
// files in the same commit. `HireOrderClause` aliases `HireOrderTerm`
// (imported above from docTypes.ts) rather than duplicating it.

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

const LEGACY_KEYS = ["lean", "standard", "full"] as const;
const LEGACY_NAMES: Record<(typeof LEGACY_KEYS)[number], string> = {
  lean: "Lean",
  standard: "Standard",
  full: "Full",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceClauses(raw: unknown): HireOrderClause[] {
  if (!Array.isArray(raw)) return [];
  const out: HireOrderClause[] = [];
  for (const c of raw) {
    if (isRecord(c) && typeof c.title === "string" && typeof c.body === "string") {
      out.push({ title: c.title, body: c.body });
    }
  }
  return out;
}

/** Normalize any stored `hire_order_terms` value to the new shape, tolerating
 *  the legacy `{lean,standard,full}` shape and junk. */
export function normalizeTermsSetting(raw: unknown): HireOrderTermsSetting {
  if (!isRecord(raw)) return { templates: [], default_id: null };

  // Legacy shape: has at least one of lean/standard/full and no `templates`.
  if (!("templates" in raw) && LEGACY_KEYS.some((k) => k in raw)) {
    return {
      templates: LEGACY_KEYS.map((k) => ({
        id: k,
        name: LEGACY_NAMES[k],
        clauses: coerceClauses(raw[k]),
      })),
      default_id: "standard",
    };
  }

  if (!Array.isArray(raw.templates)) return { templates: [], default_id: null };
  const templates: HireOrderTemplate[] = [];
  for (const t of raw.templates) {
    if (isRecord(t) && typeof t.id === "string" && typeof t.name === "string") {
      templates.push({ id: t.id, name: t.name, clauses: coerceClauses(t.clauses) });
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
// RenderInput, HireOrderLetterhead, HireOrderTerm and RenderSignature (used
// above and re-exported via `export *`) now live in ./hire-order-pdf/
// docTypes.ts, dual-homed for the browser preview — see the file header.
// `RenderHireOrderPdf` stays here: it is the DI port type for `Deps`
// (`_shared/deps.ts`), which only exists on the edge runtime. The concrete
// implementation is `./hire-order-pdf/render.tsx`.
export type RenderHireOrderPdf = (input: RenderInput) => Promise<Uint8Array>;
