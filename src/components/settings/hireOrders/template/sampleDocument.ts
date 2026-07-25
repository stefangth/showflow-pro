// The representative order the template editor previews against. Exercises
// every section (parties, facts, an aggregate's engagement dates, a running
// order, notes, fees, terms, a countersignature and therefore the certificate
// page) so no role in the outline is invisible in the preview.

import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderTheme, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";
import type { RenderInput } from "@/lib/hireOrders/pdf/docTypes";

export function sampleRenderInput(
  copy: HireOrderCopy,
  theme: HireOrderTheme,
  highlightRole?: RoleKey,
): RenderInput {
  return {
    orderNo: "HO-2026-0615-001",
    status: "preview",
    currency: "EUR",
    generatedAtIso: "2026-06-01T10:00:00.000Z",
    copy,
    theme,
    highlightRole,
    letterhead: {
      legal_name: "Meridian Stage Productions",
      address_lines: ["Kastanienallee 12", "10435 Berlin"],
      registration_line: "HRB 123456 B",
      agent_name: "Jonas Wagner",
      agent_email: "jonas@example.com",
      agent_signature_path: null,
      agent_signature_data_url: null,
    },
    terms: [
      { title: "Cancellation", body: "Either party may cancel in writing no later than 14 days before the first engagement date." },
      { title: "Travel", body: "Economy travel and single-occupancy accommodation are provided by the Producer." },
    ],
    data: {
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
    },
    signature: {
      signerName: "Alex Rivera",
      signerEmail: "alex@example.com",
      method: "typed",
      typedName: "Alex Rivera",
      signedAtIso: "2026-06-02T14:31:00.000Z",
      ip: "203.0.113.4",
      userAgent: "Mozilla/5.0",
      documentSha256: "9f2a1c4e7b8d0a3f5c6e2b9d4a7f1c8e0b3d6a9f2c5e8b1d4a7f0c3e6b9d2a5f",
      consentText: "I agree that my electronic signature is the legal equivalent of my handwritten signature.",
    },
  };
}
