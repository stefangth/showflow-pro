// Hire-order document types, shared by the PDF renderer.
//
// DUAL-HOME PAIR: src/lib/hireOrders/pdf/docTypes.ts (edit here) generates
// supabase/functions/_shared/hire-order-pdf/docTypes.ts (the edge renderer
// can't import from src/). Edit this file, then run `npm run sync:mirrors`;
// never hand-edit the generated target. CI's sync:mirrors:check fails if the
// two drift.
//
// Both runtimes' PRE-EXISTING homes for the domain types
// (supabase/functions/_shared/hireOrders.ts and src/lib/hireOrders/types.ts)
// RE-EXPORT from here rather than redeclaring, so there is exactly one
// definition per runtime and every existing import path keeps working.
//
// No relative imports other than ./pdfTheme.ts and ./pdfCopy.ts so the two
// files can be identical.

import type { HireOrderTheme } from "./pdfTheme.ts";
import type { HireOrderCopy } from "./pdfCopy.ts";

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
  /** Per-date running order + duration override. Optional: legacy stored
   *  `engagement_dates` rows predate these fields. */
  sessions?: string[];
  duration_min?: number | null;
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
  | "engagement_dates"
  // Derived by the server from the producer's fee entry, never hand-edited:
  // `fee` always holds the TOTAL payable, these two explain how it was reached.
  | "fee_basis"
  | "fee_per_date";

export type EditableOrderFieldKey = Exclude<
  OrderFieldKey,
  "engagement_dates" | "fee_basis" | "fee_per_date"
>;

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

/**
 * A resolved order snapshot.
 *
 * INVARIANT: `fee_basis` and `fee_per_date` are valid only while
 * `fee_per_date x |engagement_dates| === fee` (compared in integer cents; a
 * snapshot with no `engagement_dates` counts as one date). They are derived
 * server-side from the producer's fee entry and describe how THIS total was
 * reached, so any writer that changes `fee` must clear them or recompute them
 * in the same write. A stale pair puts a breakdown line on the PDF that
 * contradicts the total printed beneath it, and issued orders are immutable.
 * `feeBreakdownReconciles` (../feeBasis.ts) is the shared predicate; the PDF
 * renderer applies it as a last-mile guard.
 */
export type OrderData =
  & Partial<Record<OrderFieldKey, FieldValue>>
  & { engagement_dates?: FieldValue<EngagementDate[]> };

export interface FieldLayers {
  showflow?: Partial<Record<EditableOrderFieldKey, unknown>>;
  sheet?: Partial<Record<EditableOrderFieldKey, unknown>>;
  manual?: Partial<Record<EditableOrderFieldKey, unknown>>;
  defaults?: Partial<Record<EditableOrderFieldKey, unknown>>;
}

// ── renderer input ──────────────────────────────────────────────────────
//
// HireOrderLetterhead, HireOrderTerm, RenderSignature and RenderInput used to
// live only in supabase/functions/_shared/hireOrders.ts, commented as
// edge-only ("the frontend never renders PDFs"). That stopped being true the
// moment render.tsx became dual-homed: the settings editor previews the real
// document from the browser too, so RenderInput and everything it
// references have to resolve on both runtimes. They move here rather than
// getting redeclared a third time.

export interface HireOrderLetterhead {
  legal_name: string;
  address_lines: string[];
  registration_line?: string;
  agent_name?: string;
  agent_email?: string;
  /** Storage path of the org's booking-agent signature PNG (in the hire-orders
   *  bucket), drawn on the producer signature line of issued PDFs. */
  agent_signature_path?: string | null;
  /** Resolved at issue/preview time from `agent_signature_path`: the PNG as a
   *  `data:image/png;base64,...` URL for the renderer. Never persisted. */
  agent_signature_data_url?: string | null;
}

export interface HireOrderTerm {
  title: string;
  body: string;
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
  /** Resolved, complete copy dictionary (org overrides merged over defaults).
   *  Omitted in legacy call sites/tests -> the renderer uses the built-in
   *  defaults, reproducing the previous hardcoded strings exactly. */
  copy?: HireOrderCopy;
  /** Resolved theme. Absent means the built-in defaults, so legacy callers and
   *  the auto-draft trigger keep rendering exactly as before. */
  theme?: HireOrderTheme;
}
