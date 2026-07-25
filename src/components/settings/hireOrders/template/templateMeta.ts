// Editor grouping for the PDF template: which semantic roles exist, what to
// call them, and which copy keys each role prints. Frontend-only, like
// pdfCopyMeta.ts: the renderer needs none of this.
//
// The two coverage tests in TemplateEditorPage.test.tsx are the guard: add a
// RoleKey or a CopyKey and it must be placed here, or they fail. If the
// copy-key test fails, the message names the unplaced key: place it in the
// role whose style actually prints it (check render.tsx), never guess.

import type { CopyKey } from "@/lib/hireOrders/pdf/pdfCopy";
import type { RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";
import { COPY_SECTIONS } from "@/components/settings/hireOrders/pdfCopyMeta";

export interface TemplateRole {
  key: RoleKey;
  label: string;
  /** Copy keys printed with this role's style. Shown as the Text group in the
   *  inspector. May be empty for a role that only styles dynamic values. */
  copyKeys: CopyKey[];
}

export interface TemplateSection {
  title: string;
  roles: TemplateRole[];
}

export const TEMPLATE_SECTIONS: TemplateSection[] = [
  {
    title: "Letterhead",
    roles: [
      { key: "legalName", label: "Legal name", copyKeys: [] },
      { key: "letterheadLine", label: "Address lines", copyKeys: ["header_eyebrow"] },
      { key: "orderNumber", label: "Order number", copyKeys: [] },
      {
        key: "statusBadge",
        label: "Status badge",
        copyKeys: ["badge_preview", "badge_countersigned", "badge_issued"],
      },
    ],
  },
  {
    title: "Title",
    roles: [
      { key: "titleLead", label: "Lead line", copyKeys: ["title_lead"] },
      { key: "artistName", label: "Artist name", copyKeys: [] },
      {
        key: "titleSub",
        label: "Billing line",
        copyKeys: ["billing_role_and_cast", "billing_cast_only"],
      },
    ],
  },
  {
    title: "Parties",
    roles: [
      {
        key: "partyLabel",
        label: "Party label",
        copyKeys: ["party_producer_label", "party_artist_label"],
      },
      { key: "partyName", label: "Party name", copyKeys: [] },
      {
        key: "partyLine",
        label: "Party detail line",
        copyKeys: ["party_agent", "party_cast_reference", "party_engagement"],
      },
    ],
  },
  {
    title: "Facts strip",
    roles: [
      {
        key: "factLabel",
        label: "Fact label",
        copyKeys: [
          "facts_date_label",
          "facts_venue_label",
          "facts_performance_label",
          "facts_fee_label",
        ],
      },
      { key: "factValue", label: "Fact value", copyKeys: [] },
      { key: "factValueMono", label: "Fact value (numeric)", copyKeys: ["facts_duration"] },
      {
        key: "factSub",
        label: "Fact sub-label",
        copyKeys: [
          "facts_dates_count",
          "facts_sessions_count",
          "facts_single_set",
          "facts_fee_sub",
        ],
      },
    ],
  },
  {
    title: "Section headings",
    roles: [
      {
        key: "sectionHeading",
        label: "Section heading",
        copyKeys: [
          "engagement_dates_heading",
          "running_order_heading_venue",
          "running_order_heading",
          "fees_heading",
          "terms_heading",
        ],
      },
    ],
  },
  {
    title: "Tables",
    roles: [
      { key: "tableHeadCell", label: "Column header", copyKeys: ["table_call", "table_time"] },
      { key: "tableCellLabel", label: "Row label", copyKeys: ["session_label"] },
      { key: "tableCellMono", label: "Row value (numeric)", copyKeys: [] },
      { key: "notes", label: "Notes line", copyKeys: ["notes_prefix"] },
    ],
  },
  {
    title: "Fees",
    roles: [
      {
        key: "feeLabel",
        label: "Fee row label",
        copyKeys: ["fees_engagement_fee", "fees_per_date", "fees_per_date_single"],
      },
      { key: "feeValue", label: "Fee row value", copyKeys: [] },
      { key: "totalLabel", label: "Total label", copyKeys: ["fees_total"] },
      { key: "totalValue", label: "Total value", copyKeys: [] },
    ],
  },
  {
    title: "Terms",
    roles: [
      { key: "clauseNumber", label: "Clause number", copyKeys: [] },
      { key: "clauseTitle", label: "Clause title", copyKeys: [] },
      { key: "clauseBody", label: "Clause body", copyKeys: [] },
    ],
  },
  {
    title: "Signatures",
    roles: [
      {
        key: "signatureFor",
        label: "Signature heading",
        copyKeys: ["signature_for_producer", "signature_for_artist"],
      },
      {
        key: "signatureHint",
        label: "Signature hint",
        copyKeys: [
          "signature_producer_hint",
          "signature_signed_electronically",
          "signature_artist_hint",
        ],
      },
      { key: "signatureMarkTyped", label: "Typed signature mark", copyKeys: [] },
    ],
  },
  {
    title: "Footer",
    roles: [
      { key: "footerText", label: "Footer line", copyKeys: ["footer_generated"] },
      { key: "watermark", label: "Preview watermark", copyKeys: ["watermark"] },
    ],
  },
  {
    title: "Signature certificate",
    roles: [
      { key: "certHeading", label: "Certificate heading", copyKeys: ["cert_heading"] },
      { key: "certLead", label: "Certificate lead", copyKeys: ["cert_lead"] },
      {
        key: "certLabel",
        label: "Certificate label",
        copyKeys: [
          "cert_signer",
          "cert_email",
          "cert_method",
          "cert_signed_at",
          "cert_ip",
          "cert_device",
          "cert_sha",
        ],
      },
      {
        key: "certValue",
        label: "Certificate value",
        copyKeys: ["cert_method_drawn", "cert_method_typed", "cert_signed_at_value"],
      },
    ],
  },
];

/** Copy-key -> field label, derived from the existing PdfCopyCard grouping
 *  (COPY_SECTIONS) rather than retyped, so the template editor and the old
 *  settings card can never disagree about what a field is called. */
export const COPY_LABELS: Record<CopyKey, string> = Object.fromEntries(
  COPY_SECTIONS.flatMap((section) => section.fields.map((field) => [field.key, field.label] as const)),
) as Record<CopyKey, string>;
