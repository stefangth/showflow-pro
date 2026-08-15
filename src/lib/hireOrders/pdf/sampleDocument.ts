// The representative order every hire-order PDF preview renders.
//
// DUAL-HOME PAIR: src/lib/hireOrders/pdf/sampleDocument.ts (edit here)
// generates supabase/functions/_shared/hire-order-pdf/sampleDocument.ts (the
// edge renderer can't import from src/). Edit this file, then run
// `npm run sync:mirrors`; never hand-edit the generated target.
//
// WHY IT IS SHARED: the template editor shows a live browser render and an
// "Open exact PDF" button that asks the server for the real thing. Those two
// documents have to be the same document, or the exactness check is checking
// nothing. They previously came from two separately authored fixtures: the
// server's had no signature, no engagement dates and no fee basis, so the
// exact PDF was missing the certificate page, the signature mark, the
// engagement-dates section and the fee-breakdown line that the preview showed.
//
// The sample deliberately exercises EVERY section (parties, facts, an
// aggregate's engagement dates, a running order, notes, a per-date fee
// breakdown, terms, a countersignature and therefore the certificate page) so
// no role in the editor's outline is invisible in the preview.
//
// Letterhead and terms are the exception: those are the org's own text, and
// styling a fixture the org will never see is the same defect in a different
// place. Both are passed in, and the fixtures below are only the fallback for
// an org that has authored neither.
//
// No relative imports other than ./pdfTheme.ts, ./pdfCopy.ts and
// ./docTypes.ts, so the two files can be identical.

import type { HireOrderCopy } from "./pdfCopy.ts";
import type { HireOrderTheme, RoleKey } from "./pdfTheme.ts";
import type {
  HireOrderLetterhead,
  HireOrderTerm,
  OrderData,
  RenderInput,
  RenderSignature,
} from "./docTypes.ts";

export const SAMPLE_ORDER_NO = "HO-2026-0615-001";

/** Footer date for the sample. The browser preview needs a STABLE value: the
 *  pane re-renders on a debounce and a fresh `new Date()` per frame would
 *  invalidate the memoized render input on every tick. The server's live
 *  preview passes its own `deps.now()` instead, so the printed footer date is
 *  the one field the two documents may legitimately differ on. */
export const SAMPLE_GENERATED_AT_ISO = "2026-06-01T10:00:00.000Z";

/** Letterhead shown only when the org has authored none of its own. */
export const SAMPLE_LETTERHEAD: HireOrderLetterhead = {
  legal_name: "Meridian Stage Productions",
  address_lines: ["Kastanienallee 12", "10435 Berlin"],
  registration_line: "HRB 123456 B",
  agent_name: "Jonas Wagner",
  agent_email: "jonas@example.com",
  agent_signature_path: null,
  agent_signature_data_url: null,
};

/** Terms shown only when the org has authored no template with clauses. */
export const SAMPLE_TERMS: HireOrderTerm[] = [
  {
    title: "Cancellation",
    body: "Either party may cancel in writing no later than 14 days before the first engagement date.",
  },
  {
    title: "Travel",
    body: "Economy travel and single-occupancy accommodation are provided by the Producer.",
  },
];

/** A full field snapshot: three engagement dates (so the aggregate sections
 *  render), a per-date fee basis that reconciles against the total, sessions,
 *  and notes. */
export function sampleOrderData(): OrderData {
  return {
    artist_name: { value: "Alex Rivera", source: "showflow" },
    recipient_email: { value: "alex@example.com", source: "showflow" },
    role: { value: "Lead", source: "showflow" },
    cast: { value: "A-cast", source: "showflow" },
    date: { value: "2026-06-15", source: "showflow" },
    venue: { value: "Grand Theatre", source: "showflow" },
    city: { value: "Berlin", source: "showflow" },
    duration_min: { value: 90, source: "manual" },
    sessions: { value: ["18:00", "20:30"], source: "showflow" },
    fee: { value: "1500.00", source: "manual" },
    fee_basis: { value: "per_date", source: "manual" },
    fee_per_date: { value: "500.00", source: "manual" },
    currency: { value: "EUR", source: "default" },
    notes: { value: "Backline provided by the venue.", source: "manual" },
    engagement_dates: {
      value: [
        { show_date_id: "s1", date: "2026-06-15", venue: "Grand Theatre", city: "Berlin", sessions: ["18:00", "20:30"], duration_min: 90 },
        { show_date_id: "s2", date: "2026-06-16", venue: "Kammerspiele", city: "Hamburg", sessions: ["19:00"], duration_min: 90 },
        { show_date_id: "s3", date: "2026-06-17", venue: "Volksbuehne", city: "Munich", sessions: ["19:30"], duration_min: 90 },
      ],
      source: "showflow",
    },
  };
}

/** A synthetic countersignature. Kept on the sample even though the document
 *  is watermarked `preview`, so the signature mark and the whole signature
 *  certificate page (and every role on it) stay visible in the editor. */
export function sampleSignature(): RenderSignature {
  return {
    signerName: "Alex Rivera",
    signerEmail: "alex@example.com",
    method: "typed",
    typedName: "Alex Rivera",
    signedAtIso: "2026-06-02T14:31:00.000Z",
    ip: "203.0.113.4",
    userAgent: "Mozilla/5.0",
    documentSha256: "9f2a1c4e7b8d0a3f5c6e2b9d4a7f1c8e0b3d6a9f2c5e8b1d4a7f0c3e6b9d2a5f",
    consentText: "I agree that my electronic signature is the legal equivalent of my handwritten signature.",
  };
}

/** The org's letterhead, or the sample fixture when the org has authored none.
 *  A blank `legal_name` is the marker: it is the one required field, and an
 *  unconfigured org stores the empty LETTERHEAD_DEFAULT. Any resolved agent
 *  signature image survives the fallback so the producer signature line does
 *  not lose it. */
export function sampleLetterhead(stored?: HireOrderLetterhead | null): HireOrderLetterhead {
  if (stored && stored.legal_name.trim() !== "") return stored;
  return { ...SAMPLE_LETTERHEAD, agent_signature_data_url: stored?.agent_signature_data_url ?? null };
}

/** The org's terms clauses, or the sample fixture when it has authored none.
 *  An org with real clauses must see ITS clauses styled, since `clauseTitle`
 *  and `clauseBody` are editable roles. */
export function sampleTerms(stored?: HireOrderTerm[] | null): HireOrderTerm[] {
  return stored && stored.length > 0 ? stored : SAMPLE_TERMS;
}

export interface SampleRenderOptions {
  /** Resolved copy dictionary. Omitted -> the renderer's built-in defaults. */
  copy?: HireOrderCopy;
  /** Resolved theme. Omitted -> the renderer's built-in defaults. */
  theme?: HireOrderTheme;
  /** Outlines every element with this role, for the editor's outline pane. */
  highlightRole?: RoleKey;
  /** The org's stored letterhead (see `sampleLetterhead` for the fallback). */
  letterhead?: HireOrderLetterhead | null;
  /** The org's resolved terms clauses (see `sampleTerms` for the fallback). */
  terms?: HireOrderTerm[] | null;
  currency?: string;
  generatedAtIso?: string;
  /** Weekday + money locale (see RenderInput.locale). Omitted -> English. */
  locale?: "en" | "de";
}

/** Compose the whole sample document. Both preview surfaces go through this,
 *  so neither can drift into rendering a section the other does not have. */
export function sampleRenderInput(options: SampleRenderOptions = {}): RenderInput {
  return {
    orderNo: SAMPLE_ORDER_NO,
    status: "preview",
    currency: options.currency ?? "EUR",
    generatedAtIso: options.generatedAtIso ?? SAMPLE_GENERATED_AT_ISO,
    copy: options.copy,
    theme: options.theme,
    locale: options.locale,
    highlightRole: options.highlightRole,
    letterhead: sampleLetterhead(options.letterhead),
    terms: sampleTerms(options.terms),
    data: sampleOrderData(),
    signature: sampleSignature(),
  };
}
