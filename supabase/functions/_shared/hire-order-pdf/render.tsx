/// <reference types="npm:@types/react@18.3.1" />
// The hire-order PDF. Concrete implementation of the `RenderHireOrderPdf` port
// declared in ../hireOrders.ts; Task 8's edge function injects it via `Deps`.
//
// Layout is a translation of the design project's `HireOrderDoc` mock
// (claude.ai/design 2569fd28, hire-orders/HireOrderDoc.jsx) into react-pdf
// primitives, section order top to bottom. Deliberate deviations from the mock:
//   - v1 is FEE-ONLY: the mock's deposit and balance rows are a non-goal, so
//     there is one "Engagement fee" line and a "Total payable" row.
//   - Terms are the caller's; the mock's hardcoded clause text is not copied.
//     Orgs ship with none, so the whole section is omitted when `terms` is empty.
//   - The mock's per-row running-order "Notes" column has no data source in v1
//     (`sessions` is a list of times), so the table is Call/Time and the
//     order-level `notes` field renders beneath it.
//   - Aggregates (2+ engagement dates, Task B3) render each date's OWN
//     running order (from that date's `EngagementDate.sessions`) inline
//     beneath its date/venue/city row, instead of the single shared table;
//     the shared table only applies to 0/1 engagement dates.
//   - No em-dashes or en-dashes in rendered copy (house rule); the mock's "—"
//     and curly quotes become plain ASCII or a middot.
import * as React from "npm:react@18.3.1";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "npm:@react-pdf/renderer@^4";
import {
  type EngagementDate,
  formatMoney,
  type OrderData,
  type RenderInput,
} from "../hireOrders.ts";
import { GEIST_MEDIUM_B64, GEIST_MONO_REGULAR_B64, GEIST_REGULAR_B64, GEIST_SEMIBOLD_B64 } from "./fonts.ts";

// ── fonts ────────────────────────────────────────────────────────────────
// Registered from base64 data URIs, NOT Uint8Arrays: the Task 5 spike proved
// `Font.register({ src: <Uint8Array> })` throws on the edge runtime (react-pdf
// coerces the value to a filesystem path). Registration is module-scoped so a
// warm isolate parses each font once.

Font.register({
  family: "Geist",
  fonts: [
    { src: `data:font/ttf;base64,${GEIST_REGULAR_B64}`, fontWeight: 400 },
    { src: `data:font/ttf;base64,${GEIST_MEDIUM_B64}`, fontWeight: 500 },
    { src: `data:font/ttf;base64,${GEIST_SEMIBOLD_B64}`, fontWeight: 600 },
  ],
});
Font.register({
  family: "GeistMono",
  fonts: [{ src: `data:font/ttf;base64,${GEIST_MONO_REGULAR_B64}`, fontWeight: 400 }],
});

// react-pdf hyphenates at line breaks by default, which would render an org
// called "Buehnenproduktionsgesellschaft" as "Buehnenproduktions-". Names,
// venues and emails are not dictionary words; break on whole words instead.
//
// NOTE: this only governs breaks WITHIN a text run. react-pdf also treats the
// boundary between sibling children of a <Text> as a break opportunity and
// hyphenates there regardless: `<Text>Booking agent: {name}</Text>` is two
// children and wraps to "Booking agent: Jonas Wagner-". Every interpolated
// sentence below is therefore built as ONE template literal, never split
// across JSX children. Keep it that way.
Font.registerHyphenationCallback((word) => [word]);

// ── tokens ───────────────────────────────────────────────────────────────
// Mirrors the app's design tokens in src/index.css, resolved to hex because a
// PDF has no CSS custom properties and always renders on white paper.

const C = {
  text: "#15131C", // --foreground
  muted: "#5B5A57", // --muted-foreground
  faint: "#8B8A85", // --text-faint
  accent: "#4738B0", // --accent-700 (the -600 stop is too light on paper)
  line: "#E5E2DA", // --line-strong, flattened onto white
  feeCell: "#F4F1FF", // --accent-50
  surface2: "#FAF8F4", // --muted
  white: "#FFFFFF",
} as const;

const s = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontWeight: 400,
    fontSize: 11,
    color: C.text,
    backgroundColor: C.white,
    paddingTop: 40,
    paddingBottom: 60, // clears the fixed footer
    paddingHorizontal: 44,
  },

  // Letterhead
  letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  brandTile: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: C.text,
    color: C.white,
    fontSize: 13,
    fontWeight: 600,
    textAlign: "center",
    paddingTop: 6,
    marginRight: 8,
  },
  legalName: { fontSize: 16, fontWeight: 600 },
  eyebrow: { fontSize: 9, color: C.faint, marginTop: 2 },
  eyebrowRight: { fontSize: 9, color: C.faint, textAlign: "right" },
  orderNo: { fontFamily: "GeistMono", fontSize: 15, fontWeight: 600, marginTop: 3, textAlign: "right" },
  badgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 5 },
  badgeDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 4 },
  badgeText: { fontSize: 9, fontWeight: 500, color: C.muted },

  // Title
  title: { marginTop: 22 },
  titleLead: { fontSize: 11, color: C.muted },
  artistName: { fontSize: 30, fontWeight: 600, letterSpacing: -0.5, marginTop: 4 },
  titleSub: { fontSize: 12, color: C.muted, marginTop: 4 },

  // Parties
  parties: { flexDirection: "row", marginTop: 22 },
  party: { flex: 1 },
  partyGap: { width: 28 },
  partyLabel: { fontSize: 9, color: C.faint, marginBottom: 5 },
  partyName: { fontSize: 13.5, fontWeight: 600 },
  partyLine: { fontSize: 11, color: C.muted, marginTop: 2 },

  // Facts strip
  facts: {
    flexDirection: "row",
    marginTop: 22,
    borderWidth: 0.5,
    borderColor: C.line,
    borderRadius: 10,
    overflow: "hidden",
  },
  factCell: { flex: 1, padding: 10 },
  factDivider: { borderLeftWidth: 0.5, borderLeftColor: C.line },
  factCellFee: { backgroundColor: C.feeCell },
  factLabel: { fontSize: 8, color: C.faint, marginBottom: 3 },
  factValue: { fontSize: 12, fontWeight: 500 },
  factValueMono: { fontFamily: "GeistMono", fontSize: 12, fontWeight: 400 },
  factSub: { fontSize: 9, color: C.muted, marginTop: 2 },

  // Section
  section: { marginTop: 20 },
  sectionHeading: { fontSize: 12, fontWeight: 600, marginBottom: 8 },

  // Running order
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingBottom: 5,
  },
  tableHeadCell: { fontSize: 8, color: C.faint },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingVertical: 6,
  },
  colCall: { width: "30%" },
  colTime: { width: "70%" },
  cellLabel: { fontSize: 12, fontWeight: 600 },
  cellTime: { fontFamily: "GeistMono", fontSize: 12 },
  notes: { fontSize: 11, color: C.muted, marginTop: 8 },

  // Aggregate engagement dates
  engagementDateRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingVertical: 6,
  },
  engagementDateValue: { width: "28%", fontFamily: "GeistMono", fontSize: 10.5 },
  engagementDatePlace: { flex: 1, fontSize: 10.5 },
  engagementDateCity: { width: "25%", fontSize: 10.5, color: C.muted },

  // Fees
  feeRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  feeLabel: { fontSize: 12 },
  feeValue: { fontFamily: "GeistMono", fontSize: 12 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1.5,
    borderTopColor: C.text,
    backgroundColor: C.surface2,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  totalLabel: { fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  totalValue: { fontFamily: "GeistMono", fontSize: 17, fontWeight: 600 },

  // Terms
  clause: { flexDirection: "row", marginBottom: 7 },
  clauseNo: { fontFamily: "GeistMono", fontSize: 11, fontWeight: 600, color: C.accent, width: 18 },
  clauseBody: { flex: 1, fontSize: 10.5, color: C.muted, lineHeight: 1.4 },
  clauseTitle: { fontWeight: 600, color: C.text },

  // Signatures
  signatures: { flexDirection: "row", marginTop: 28 },
  signature: { flex: 1 },
  signatureGap: { width: 40 },
  signatureFor: { fontSize: 11, fontWeight: 500, marginBottom: 26 },
  signatureLine: { borderBottomWidth: 0.5, borderBottomColor: C.text },
  signatureHint: { fontSize: 9, color: C.faint, marginTop: 5 },

  // Applied (countersigned) signature mark
  sigMarkTyped: { fontFamily: "Geist", fontSize: 22, fontWeight: 600, color: C.text, marginBottom: 2 },
  sigMarkImage: { height: 44, marginBottom: 2, objectFit: "contain" },
  // Certificate page
  certHeading: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
  certLead: { fontSize: 11, color: C.muted, marginBottom: 18 },
  certRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, paddingVertical: 7 },
  certLabel: { width: "34%", fontSize: 10, color: C.faint },
  certValue: { flex: 1, fontSize: 10.5, color: C.text },
  certValueMono: { flex: 1, fontFamily: "GeistMono", fontSize: 9.5, color: C.text },
  certConsent: { marginTop: 16, fontSize: 10, color: C.muted, lineHeight: 1.4 },

  // Footer
  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 8,
  },
  footerText: { fontSize: 8.5, color: C.faint },
  footerMono: { fontFamily: "GeistMono", fontSize: 8.5, color: C.faint },

  // Watermark
  watermark: {
    position: "absolute",
    top: 360,
    left: 90,
    fontSize: 48,
    fontWeight: 600,
    letterSpacing: 6,
    color: C.text,
    opacity: 0.08,
    transform: "rotate(-30deg)",
  },
});

// ── field + date helpers ─────────────────────────────────────────────────

/** Read a snapshot field as a string; "" when it was never captured. */
function str(data: OrderData, key: keyof OrderData): string {
  const value = data[key]?.value;
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

/**
 * `dd/MM/yyyy` from a `YYYY-MM-DD` string, sliced rather than parsed so no
 * timezone can shift the day (same reasoning as formatOrderNo).
 */
function formatDateDMY(dateOnly: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateOnly)) return dateOnly;
  return `${dateOnly.slice(8, 10)}/${dateOnly.slice(5, 7)}/${dateOnly.slice(0, 4)}`;
}

/** Weekday for a `YYYY-MM-DD` string, pinned to UTC so it is deterministic. */
function weekdayOf(dateOnly: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateOnly)) return "";
  const d = new Date(`${dateOnly.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** `dd/MM/yyyy` from a full ISO timestamp, on the UTC calendar date. */
function formatIsoDMY(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDateDMY(d.toISOString().slice(0, 10));
}

/**
 * `dd/MM/yyyy HH:MM` (UTC) from a full ISO timestamp. The signature certificate
 * is an audit record, so it needs minute precision: two signatures on the same
 * calendar day render identically with a date alone. Hour/minute are read on the
 * UTC clock (deterministic, matches the "(UTC)" label the row carries).
 */
function formatIsoDateTimeUTC(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDateDMY(d.toISOString().slice(0, 10))} ${hh}:${mm}`;
}

/** `sessions` is a list of time strings; anything else renders no rows. */
function sessionsOf(data: OrderData): string[] {
  const value = data.sessions?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((v) => v !== undefined && v !== null && v !== "").map(String);
}

/**
 * Validated engagement dates, each carrying its own `sessions`/`duration_min`
 * (Task B3). Both are optional on the stored type because legacy rows
 * predate them; normalize a missing or malformed value to `[]` / `null`
 * rather than propagating `undefined` into the renderer.
 */
function engagementDatesOf(data: OrderData): EngagementDate[] {
  const value = data.engagement_dates?.value;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is EngagementDate => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<EngagementDate>;
      return typeof row.show_date_id === "string" &&
        typeof row.date === "string" &&
        (row.venue === null || typeof row.venue === "string") &&
        (row.city === null || typeof row.city === "string");
    })
    .map((item) => ({
      ...item,
      sessions: Array.isArray(item.sessions) && item.sessions.every((v) => typeof v === "string")
        ? item.sessions
        : [],
      duration_min: typeof item.duration_min === "number" ? item.duration_min : null,
    }));
}

// ── document ─────────────────────────────────────────────────────────────

function HireOrderDoc(input: RenderInput): React.ReactElement {
  const { data, orderNo, status, letterhead, terms, currency, generatedAtIso, signature } = input;

  const artist = str(data, "artist_name");
  const email = str(data, "recipient_email");
  const role = str(data, "role");
  const cast = str(data, "cast");
  const date = str(data, "date");
  const venue = str(data, "venue");
  const city = str(data, "city");
  const duration = str(data, "duration_min");
  const notes = str(data, "notes");
  const fee = data.fee?.value;
  const feeText = fee === undefined || fee === null || fee === ""
    ? ""
    : formatMoney(fee as string | number, currency);
  const sessions = sessionsOf(data);
  const engagementDates = engagementDatesOf(data);
  const isAggregate = engagementDates.length > 1;
  const dateLabel = isAggregate
    ? engagementDates.map((item) => formatDateDMY(item.date)).join(" · ")
    : formatDateDMY(date);
  const billing = role && cast ? `${role} · billed as ${cast}` : cast ? `Billed as ${cast}` : role;

  return (
    <Document title={`Hire order ${orderNo}`} author={letterhead.legal_name} creator="ShowFlow Pro">
      <Page size="A4" style={s.page}>
        {/* Letterhead */}
        <View style={s.letterhead}>
          <View>
            <View style={s.brandRow}>
              <Text style={s.brandTile}>{(letterhead.legal_name.trim()[0] ?? "?").toUpperCase()}</Text>
              <Text style={s.legalName}>{letterhead.legal_name}</Text>
            </View>
            {letterhead.address_lines.map((line, i) => <Text key={i} style={s.eyebrow}>{line}</Text>)}
            {letterhead.registration_line ? <Text style={s.eyebrow}>{letterhead.registration_line}</Text> : null}
          </View>
          <View>
            <Text style={s.eyebrowRight}>Performance hire order</Text>
            <Text style={s.orderNo}>{orderNo}</Text>
            <View style={s.badgeRow}>
              <View style={[s.badgeDot, { backgroundColor: status === "preview" ? C.faint : C.accent }]} />
              <Text style={s.badgeText}>
                {status === "preview" ? "Preview" : status === "countersigned" ? "Countersigned" : "Issued"}
              </Text>
            </View>
          </View>
        </View>

        {/* Title */}
        <View style={s.title}>
          <Text style={s.titleLead}>This order confirms the engagement of</Text>
          <Text style={s.artistName}>{artist}</Text>
          {billing ? <Text style={s.titleSub}>{billing}</Text> : null}
        </View>

        {/* Parties */}
        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>Hiring party, the Producer</Text>
            <Text style={s.partyName}>{letterhead.legal_name}</Text>
            {letterhead.address_lines.map((line, i) => <Text key={i} style={s.partyLine}>{line}</Text>)}
            {letterhead.agent_name
              ? <Text style={s.partyLine}>{`Booking agent: ${letterhead.agent_name}`}</Text>
              : null}
            {letterhead.agent_email ? <Text style={s.partyLine}>{letterhead.agent_email}</Text> : null}
          </View>
          <View style={s.partyGap} />
          <View style={s.party}>
            <Text style={s.partyLabel}>Engaged artist, the Artist</Text>
            <Text style={s.partyName}>{artist}</Text>
            {email ? <Text style={s.partyLine}>{email}</Text> : null}
            {cast ? <Text style={s.partyLine}>{`Cast reference: ${cast}`}</Text> : null}
            {role ? <Text style={s.partyLine}>{`Engagement: ${role}`}</Text> : null}
          </View>
        </View>

        {/* Facts strip */}
        <View style={s.facts}>
          <View style={s.factCell}>
            <Text style={s.factLabel}>Date</Text>
            <Text style={s.factValueMono}>{dateLabel}</Text>
            <Text style={s.factSub}>{isAggregate ? `${engagementDates.length} dates` : weekdayOf(date)}</Text>
          </View>
          <View style={[s.factCell, s.factDivider]}>
            <Text style={s.factLabel}>Venue</Text>
            <Text style={s.factValue}>{venue}</Text>
            <Text style={s.factSub}>{city}</Text>
          </View>
          <View style={[s.factCell, s.factDivider]}>
            <Text style={s.factLabel}>Performance</Text>
            <Text style={s.factValueMono}>{duration ? `${duration} min` : ""}</Text>
            <Text style={s.factSub}>{sessions.length > 1 ? `${sessions.length} sessions` : "Single set"}</Text>
          </View>
          <View style={[s.factCell, s.factDivider, s.factCellFee]}>
            <Text style={s.factLabel}>Engagement fee</Text>
            <Text style={s.factValueMono}>{feeText}</Text>
            <Text style={s.factSub}>net of VAT</Text>
          </View>
        </View>

        {isAggregate
          ? (
            <View style={s.section}>
              <Text style={s.sectionHeading}>Engagement dates</Text>
              {engagementDates.map((item) => (
                <View key={item.show_date_id}>
                  <View style={s.engagementDateRow} wrap={false}>
                    <Text style={s.engagementDateValue}>{formatDateDMY(item.date)}</Text>
                    <Text style={s.engagementDatePlace}>{item.venue ?? ""}</Text>
                    <Text style={s.engagementDateCity}>{item.city ?? ""}</Text>
                  </View>
                  {(item.sessions ?? []).map((time, i) => (
                    <View key={i} style={s.tableRow} wrap={false}>
                      <Text style={[s.cellLabel, s.colCall]}>{`Session ${i + 1}`}</Text>
                      <Text style={[s.cellTime, s.colTime]}>{time}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )
          : null}

        {/* Running order: the single shared table only applies to 0/1
            engagement dates. Aggregates (isAggregate, 2+ dates) render each
            date's own running order inline above instead, from that date's
            own `sessions` (see the engagement-dates block). */}
        {!isAggregate && sessions.length > 0
          ? (
            <View style={s.section}>
              <Text style={s.sectionHeading}>{venue ? `Running order, ${venue}` : "Running order"}</Text>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, s.colCall]}>Call</Text>
                <Text style={[s.tableHeadCell, s.colTime]}>Time</Text>
              </View>
              {sessions.map((time, i) => (
                <View key={i} style={s.tableRow} wrap={false}>
                  <Text style={[s.cellLabel, s.colCall]}>{`Session ${i + 1}`}</Text>
                  <Text style={[s.cellTime, s.colTime]}>{time}</Text>
                </View>
              ))}
              {notes ? <Text style={s.notes}>{`Notes: ${notes}`}</Text> : null}
            </View>
          )
          : null}

        {/* Fees */}
        <View style={s.section}>
          <Text style={s.sectionHeading}>Fees & payment schedule</Text>
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>Engagement fee</Text>
            <Text style={s.feeValue}>{feeText}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total payable</Text>
            <Text style={s.totalValue}>{feeText}</Text>
          </View>
        </View>

        {/* Terms — omitted entirely when the org has none, so no empty heading */}
        {terms.length > 0
          ? (
            <View style={s.section}>
              <Text style={s.sectionHeading}>Terms & conditions</Text>
              {terms.map((clause, i) => (
                <View key={i} style={s.clause} wrap={false}>
                  <Text style={s.clauseNo}>{i + 1}</Text>
                  <Text style={s.clauseBody}>
                    <Text style={s.clauseTitle}>{clause.title}.</Text> {clause.body}
                  </Text>
                </View>
              ))}
            </View>
          )
          : null}

        {/* Signatures */}
        <View style={s.signatures} wrap={false}>
          <View style={s.signature}>
            <Text style={s.signatureFor}>{`For the Producer · ${letterhead.legal_name}`}</Text>
            <View style={s.signatureLine} />
            <Text style={s.signatureHint}>{`Name · Date ${formatDateDMY(date)}`}</Text>
          </View>
          <View style={s.signatureGap} />
          <View style={s.signature}>
            <Text style={s.signatureFor}>{`The Artist · ${artist}`}</Text>
            {signature
              ? (signature.method === "drawn" && signature.imageDataUrl
                ? <Image style={s.sigMarkImage} src={signature.imageDataUrl} />
                : <Text style={s.sigMarkTyped}>{signature.typedName ?? signature.signerName}</Text>)
              : null}
            <View style={s.signatureLine} />
            <Text style={s.signatureHint}>
              {signature ? `Signed electronically · ${formatIsoDMY(signature.signedAtIso)}` : "Signature · Date"}
            </Text>
          </View>
        </View>

        {status === "preview" ? <Text style={s.watermark} fixed>PREVIEW</Text> : null}

        {/* Footer. Page numbers are rendered, not hardcoded "1 / 1": long terms
            can push the document past one page. */}
        <View style={s.footer} fixed>
          <Text style={s.footerMono}>{orderNo}</Text>
          <Text style={s.footerText}>{`Generated by ShowFlow Pro · ${formatIsoDMY(generatedAtIso)}`}</Text>
          <Text
            style={s.footerMono}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
      {signature ? (
        <Page size="A4" style={s.page}>
          <Text style={s.certHeading}>Signature certificate</Text>
          <Text style={s.certLead}>{`Electronic signature record for hire order ${orderNo}.`}</Text>
          <View style={s.certRow}><Text style={s.certLabel}>Signer</Text><Text style={s.certValue}>{signature.signerName}</Text></View>
          {signature.signerEmail ? <View style={s.certRow}><Text style={s.certLabel}>Email</Text><Text style={s.certValue}>{signature.signerEmail}</Text></View> : null}
          <View style={s.certRow}><Text style={s.certLabel}>Method</Text><Text style={s.certValue}>{signature.method === "drawn" ? "Drawn signature" : "Typed signature"}</Text></View>
          <View style={s.certRow}><Text style={s.certLabel}>Signed at</Text><Text style={s.certValue}>{`${formatIsoDateTimeUTC(signature.signedAtIso)} (UTC)`}</Text></View>
          {signature.ip ? <View style={s.certRow}><Text style={s.certLabel}>IP address</Text><Text style={s.certValue}>{signature.ip}</Text></View> : null}
          {signature.userAgent ? <View style={s.certRow}><Text style={s.certLabel}>Device</Text><Text style={s.certValue}>{signature.userAgent}</Text></View> : null}
          <View style={s.certRow}><Text style={s.certLabel}>Document SHA-256</Text><Text style={s.certValueMono}>{signature.documentSha256}</Text></View>
          <Text style={s.certConsent}>{signature.consentText}</Text>
          <View style={s.footer} fixed>
            <Text style={s.footerMono}>{orderNo}</Text>
            <Text style={s.footerText}>{`Generated by ShowFlow Pro · ${formatIsoDMY(generatedAtIso)}`}</Text>
            <Text style={s.footerMono} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ) : null}
    </Document>
  );
}

/** Concrete `RenderHireOrderPdf`. */
export async function renderHireOrderPdf(input: RenderInput): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<HireOrderDoc {...input} />));
}
