// UI metadata for the editable hire-order PDF copy (PdfCopyCard). Frontend-only:
// the edge renderer needs none of this (it only reads the resolved dictionary),
// so this is NOT part of the dual-home byte-identical core (pdfCopy.ts).
//
// The "covers every CopyKey exactly once" test in pdfCopyMeta.test.ts is the
// guard that keeps this grouping in sync with the registry: add a CopyKey and
// this file must place it in a section, or the test fails.

import type { CopyKey } from "@/lib/hireOrders/pdf/pdfCopy";

export interface CopyField {
  key: CopyKey;
  label: string;
  /** Token names (without braces) that this field's default template contains,
   *  surfaced as an inline hint. Empty for static strings. */
  tokens: string[];
  /** Render as a multi-line textarea (longer sentences) instead of an input. */
  multiline?: boolean;
}

export interface CopySection {
  title: string;
  fields: CopyField[];
}

export const COPY_SECTIONS: CopySection[] = [
  {
    title: "Header & status",
    fields: [
      { key: "header_eyebrow", label: "Document eyebrow", tokens: [] },
      { key: "badge_preview", label: "Preview badge", tokens: [] },
      { key: "badge_countersigned", label: "Countersigned badge", tokens: [] },
      { key: "badge_issued", label: "Issued badge", tokens: [] },
    ],
  },
  {
    title: "Title",
    fields: [
      { key: "title_lead", label: "Lead line", tokens: [] },
      { key: "billing_role_and_cast", label: "Billing (role and cast)", tokens: ["role", "cast"] },
      { key: "billing_cast_only", label: "Billing (cast only)", tokens: ["cast"] },
    ],
  },
  {
    title: "Parties",
    fields: [
      { key: "party_producer_label", label: "Producer label", tokens: [] },
      { key: "party_agent", label: "Booking agent line", tokens: ["agent_name"] },
      { key: "party_artist_label", label: "Artist label", tokens: [] },
      { key: "party_cast_reference", label: "Cast reference line", tokens: ["cast"] },
      { key: "party_engagement", label: "Engagement line", tokens: ["role"] },
    ],
  },
  {
    title: "Facts strip",
    fields: [
      { key: "facts_date_label", label: "Date label", tokens: [] },
      { key: "facts_dates_count", label: "Multiple-dates count", tokens: ["count"] },
      { key: "facts_venue_label", label: "Venue label", tokens: [] },
      { key: "facts_performance_label", label: "Performance label", tokens: [] },
      { key: "facts_duration", label: "Duration value", tokens: ["duration"] },
      { key: "facts_sessions_count", label: "Sessions count", tokens: ["count"] },
      { key: "facts_single_set", label: "Single-set label", tokens: [] },
      { key: "facts_fee_label", label: "Fee label", tokens: [] },
      { key: "facts_fee_sub", label: "Fee sub-label", tokens: [] },
    ],
  },
  {
    title: "Engagement dates & running order",
    fields: [
      { key: "engagement_dates_heading", label: "Engagement dates heading", tokens: [] },
      { key: "session_label", label: "Session row label", tokens: ["n"] },
      { key: "running_order_heading_venue", label: "Running order heading (with venue)", tokens: ["venue"] },
      { key: "running_order_heading", label: "Running order heading", tokens: [] },
      { key: "table_call", label: "Call column header", tokens: [] },
      { key: "table_time", label: "Time column header", tokens: [] },
    ],
  },
  {
    title: "Notes",
    fields: [
      { key: "notes_prefix", label: "Notes line", tokens: ["notes"], multiline: true },
    ],
  },
  {
    title: "Fees",
    fields: [
      { key: "fees_heading", label: "Fees heading", tokens: [] },
      { key: "fees_engagement_fee", label: "Engagement fee row", tokens: [] },
      { key: "fees_per_date", label: "Per-date breakdown row", tokens: ["amount", "count"] },
      { key: "fees_per_date_single", label: "Per-date breakdown row (one date)", tokens: ["amount"] },
      { key: "fees_total", label: "Total row", tokens: [] },
    ],
  },
  {
    title: "Terms & conditions",
    fields: [
      { key: "terms_heading", label: "Terms heading", tokens: [] },
    ],
  },
  {
    title: "Signatures",
    fields: [
      { key: "signature_for_producer", label: "Producer signature line", tokens: ["legal_name"] },
      { key: "signature_producer_hint", label: "Producer signature hint", tokens: ["date"] },
      { key: "signature_for_artist", label: "Artist signature line", tokens: ["artist"] },
      { key: "signature_signed_electronically", label: "Signed-electronically hint", tokens: ["date"] },
      { key: "signature_artist_hint", label: "Artist signature hint", tokens: [] },
    ],
  },
  {
    title: "Watermark & footer",
    fields: [
      { key: "watermark", label: "Preview watermark", tokens: [] },
      { key: "footer_generated", label: "Footer line", tokens: ["date"] },
    ],
  },
  {
    title: "Signature certificate",
    fields: [
      { key: "cert_heading", label: "Certificate heading", tokens: [] },
      { key: "cert_lead", label: "Certificate lead", tokens: ["orderNo"], multiline: true },
      { key: "cert_signer", label: "Signer label", tokens: [] },
      { key: "cert_email", label: "Email label", tokens: [] },
      { key: "cert_method", label: "Method label", tokens: [] },
      { key: "cert_method_drawn", label: "Drawn-method value", tokens: [] },
      { key: "cert_method_typed", label: "Typed-method value", tokens: [] },
      { key: "cert_signed_at", label: "Signed-at label", tokens: [] },
      { key: "cert_signed_at_value", label: "Signed-at value", tokens: ["datetime"] },
      { key: "cert_ip", label: "IP address label", tokens: [] },
      { key: "cert_device", label: "Device label", tokens: [] },
      { key: "cert_sha", label: "Document hash label", tokens: [] },
    ],
  },
];

/** House rule: hire-order copy must not contain em (—) or en (–) dashes. */
export function hasBadDash(text: string): boolean {
  return /[–—]/.test(text);
}
