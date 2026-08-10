// The Trust Center's claim tables — the single source of truth behind both the
// in-app Settings > Trust & data tab and the public showflow.pro/trust page
// (the latter via the generated public/trust.json; see scripts/build-trust-json.mjs).
//
// GOVERNING RULE: every string in this file must be traceable to code in this
// repo or to a published artefact. If you cannot point at the migration, the
// test, or the policy section that makes a sentence true, it does not belong
// here. Two test files enforce the mechanical half of that promise:
// facts.privacy.test.ts diffs the retention and subprocessor tables against
// docs/legal/privacy-policy.en.md, and capabilityInventory.test.ts pins the
// counts this page prints to CAPABILITY_DEFS.
//
// Deliberately absent: anything the source design carried that we cannot
// evidence — third-party attestations, uptime commitments, penetration-test
// results, and the "ShowFlow staff" column of the visibility matrix.

/** The roles a reader can inspect. Mirrors the grantable app_role values that
 *  exist inside an organisation; platform admins are out of scope here. */
export type TrustRole = "admin" | "producer" | "artist";

export const TRUST_ROLES: { value: TrustRole; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "producer", label: "Production team" },
  { value: "artist", label: "Artist" },
];

/** Visual weight of an access answer. Maps to a token pair in the UI. */
export type AccessTone = "full" | "scoped" | "none" | "gated";

export interface AccessCell {
  /** The short answer, e.g. "Full" or "Own record". */
  value: string;
  tone: AccessTone;
  /** The mechanism — why the answer is what it is. */
  note: string;
}

export interface MatrixRow {
  object: string;
  admin: AccessCell;
  producer: AccessCell;
  artist: AccessCell;
}

/** Who can read what, and the mechanism that decides it.
 *  Each cell is asserted against the RLS policy that produces it. */
export const VISIBILITY_MATRIX: MatrixRow[] = [
  {
    object: "Artist contact details",
    admin: { value: "Full", tone: "full", note: "Every artist record in this organisation." },
    producer: { value: "Full", tone: "full", note: 'Editing needs the "edit artists" right.' },
    artist: { value: "Own record", tone: "scoped", note: "A row-level policy limits reads to your own profile." },
  },
  {
    object: "Availability and blocked dates",
    admin: { value: "Full", tone: "full", note: "Needed to route dates." },
    producer: { value: "Full", tone: "full", note: "Needed to route dates." },
    artist: { value: "Own dates", tone: "scoped", note: "You declare them; nobody outside the organisation reads them." },
  },
  {
    object: "Booking status and offers",
    admin: { value: "Full", tone: "full", note: "Across every production." },
    producer: { value: "Full", tone: "full", note: 'Confirming needs the "confirm bookings" right.' },
    artist: { value: "Own offers", tone: "scoped", note: "You see your own tier, never another artist's." },
  },
  {
    object: "Booking notes and cancellation reasons",
    admin: { value: "Full", tone: "full", note: "Free text written by the production team." },
    producer: { value: "Full", tone: "full", note: "Free text written by the production team." },
    // Honest correction to the source design, which claimed "No access". These
    // are columns on `bookings`, and the artist's own-row SELECT policy returns
    // the whole row. The interface does not draw them; the API does return them.
    artist: {
      value: "Own booking",
      tone: "scoped",
      note: "These are fields on your own booking row, so they come back with it. Another artist's never do.",
    },
  },
  {
    object: "Hire-order fees",
    admin: { value: "Full", tone: "full", note: "Letterhead, numbering, and terms included." },
    producer: { value: "Grant-gated", tone: "gated", note: "Issuing and voiding are sensitive rights, confirmed twice." },
    artist: { value: "Own order", tone: "scoped", note: "Your own hire order and its PDF only." },
  },
  {
    object: "Show-date chat",
    // is_chat_participant() returns true for any org admin or producer on any
    // chat in their org, and the INSERT policy calls the same function — so
    // neither role is read-only nor participant-limited.
    admin: { value: "Full", tone: "full", note: "Any thread in this organisation. Hidden from the list 30 days after the show date." },
    producer: { value: "Full", tone: "full", note: "Any thread in this organisation." },
    artist: { value: "Own dates", tone: "scoped", note: "Only threads for dates you are cast on." },
  },
  {
    object: "Booking audit log",
    admin: { value: "Full", tone: "full", note: "Actor, action, reason, timestamp." },
    producer: { value: "Read-only", tone: "scoped", note: "Writes to it and reads it. No policy allows altering a row." },
    artist: { value: "No access", tone: "none", note: "Not exposed." },
  },
  {
    object: "Another organisation's data",
    admin: { value: "No access", tone: "none", note: "A restrictive policy on every table blocks the read." },
    producer: { value: "No access", tone: "none", note: "A restrictive policy on every table blocks the read." },
    artist: { value: "No access", tone: "none", note: "A restrictive policy on every table blocks the read." },
  },
];

export interface Kpi {
  icon: string;
  label: string;
  value: string;
}

/** The four facts a reviewer scans first. Each is checkable. */
export const TRUST_KPIS: Kpi[] = [
  { icon: "lock", label: "Tenant isolation", value: "Row-level, asserted on every commit" },
  // Scoped to the database on purpose. The Postgres project is eu-west-1, but
  // hosting and transactional email are US processors under DPF + SCCs, so a
  // bare "Data residency: EU" would overclaim. The subprocessor table carries
  // the per-processor regions.
  { icon: "globe", label: "Database region", value: "European Union (Ireland)" },
  { icon: "server", label: "Subprocessors", value: "6 named, 2 consent-only" },
  { icon: "users", label: "Access control", value: "28 rights, 9 sensitive, 9 off by default" },
];

export interface Control {
  icon: string;
  title: string;
  /** The control, in plain words. */
  claim: string;
  /** Where a reviewer can go to check it. */
  evidence: string;
}

export const CONTROLS: Control[] = [
  {
    icon: "lock",
    title: "Tenant isolation",
    claim:
      "Every table holding your data carries its organisation, down to individual chat messages and audit rows. One restrictive database policy per table means a session reads only organisations it belongs to. Restrictive policies filter; they never grant.",
    evidence:
      "supabase/tests/rls/org_isolation.sql asserts org A reads and writes zero rows of org B, even holding a global producer role. It runs on every pull request.",
  },
  {
    icon: "users",
    title: "Roles and rights",
    claim:
      "Three roles per organisation. Every read and write is authorised in the database; the interface only decides what to draw. Nine rights are marked sensitive and ask for a second confirmation before they take effect. Nine ship switched off until an administrator turns them on.",
    evidence:
      "28 rights across 8 groups. The two sets overlap but are not the same: issuing and voiding hire orders are sensitive yet on, because a production team that cannot issue an order cannot work.",
  },
  {
    icon: "key",
    title: "Encryption and secrets",
    claim:
      "TLS in transit, encryption at rest in managed Postgres. Integration keys live in a secrets vault and are readable only by server functions, never by members of your organisation.",
    evidence:
      "The Airtable key is written to Supabase Vault through an admin-guarded function and is never read back to a client.",
  },
  {
    icon: "file-text",
    title: "Auditability",
    claim:
      "Booking changes are appended to a log: who acted, what changed, the reason given, the timestamp. Administrators and the production team can read it; no policy on the table permits an update or a delete.",
    evidence: "Retained three years from the show date, per section 7 of the privacy policy.",
  },
  {
    icon: "shield",
    title: "Application security",
    claim:
      "Role checks run as security-definer database functions rather than being scattered through queries. Every pull request is scanned for committed secrets, and dependency updates arrive as grouped weekly pull requests.",
    evidence:
      "Checks concentrated in has_org_role, is_org_member, is_capability_enabled, is_feature_enabled, and capability_default — one place to audit.",
  },
  {
    icon: "database",
    title: "Backups",
    claim:
      "Managed Postgres with a rolling 30-day backup window. Data deleted from the live database leaves the backups inside that window.",
    evidence: "Stated in section 7 of the privacy policy.",
  },
];

export interface Subprocessor {
  name: string;
  purpose: string;
  region: string;
  transfer: string;
  status: "Core" | "Consent" | "Off";
  tone: AccessTone;
}

/** Mirrors section 6 of docs/legal/privacy-policy.en.md. Asserted by test. */
export const SUBPROCESSORS: Subprocessor[] = [
  { name: "Supabase", purpose: "Database, authentication, storage", region: "EU · US", transfer: "EU region in use · DPF + SCCs", status: "Core", tone: "full" },
  { name: "Vercel", purpose: "Application hosting, edge network", region: "EU · US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Resend", purpose: "Transactional email", region: "US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Sentry", purpose: "Client error reports", region: "EU · US", transfer: "EU region where available · SCCs", status: "Consent", tone: "scoped" },
  { name: "PostHog", purpose: "Analytics, session replay", region: "EU · US", transfer: "EU region where available · SCCs", status: "Consent", tone: "scoped" },
  { name: "Airtable", purpose: "Show-data sync", region: "US", transfer: "DPF + SCCs", status: "Off", tone: "none" },
];

export const TRANSFER_BASIS_NOTE =
  "Adequacy decision of 10 July 2023 (EU–US Data Privacy Framework) or the Standard Contractual Clauses of 4 June 2021, with encryption in transit and at rest.";

export interface RetentionRow {
  item: string;
  period: string;
}

/** Mirrors section 7 of docs/legal/privacy-policy.en.md. Asserted by test.
 *  The first three are the ones people actually ask about; the summary view
 *  on the public page shows only those. */
export const RETENTION: RetentionRow[] = [
  { item: "Bookings and audit log", period: "3 years from show date" },
  { item: "Show-date chat", period: "Archived 30 days · deleted 12 months" },
  { item: "Backups", period: "Rolling 30 days" },
  { item: "Account and profile", period: "Life of account + 30 days" },
  { item: "Email send log and suppressions", period: "24 months" },
  { item: "Hosting and database logs", period: "7–30 days" },
  { item: "Error reports", period: "90 days" },
  { item: "Analytics and session replay", period: "12 months" },
];

export interface SelfServeRight {
  icon: string;
  title: string;
  detail: string;
}

/** Only rights that are actually wired to something today. */
export const SELF_SERVE_RIGHTS: SelfServeRight[] = [
  {
    icon: "download",
    title: "Export your data",
    detail: "A machine-readable export of everything tied to your account, from your profile page. Art. 15 and 20.",
  },
  {
    icon: "eye",
    title: "Withdraw analytics consent",
    detail: "Analytics, session replay, and error tracking stop immediately. Art. 7(3).",
  },
  {
    icon: "alert",
    title: "Delete your account",
    detail: "Removes your account and anonymises what must be retained for booking records. Art. 17.",
  },
  {
    icon: "mail",
    title: "Object or restrict",
    detail: "One address, one month to answer, no ticket queue. Art. 18 and 21.",
  },
];

export interface TrustDocument {
  title: string;
  meta: string;
  /** Absolute, because this list renders on two different hosts. `mailto:`
   *  marks a request rather than a download. */
  href: string;
  /** Label for the action control. Must describe what actually happens. */
  cta: string;
}

// Absolute hosts, deliberately. This list is rendered by the app AND by the
// landing page, and the two do not host the same documents: there is no /terms
// in the app, and showflow.pro/privacy is the *marketing site's* policy, not the
// product policy that backs the tables above. Relative links would silently
// resolve to the wrong document on one of the two surfaces.
//
// Kept as literals rather than imported from app.config so this module stays
// free of path aliases and can be read directly by scripts/build-trust-json.mjs.
// factsUrls.test.ts asserts they still match APP_META.
const APP_HOST = "https://app.showflow.pro";
const MARKETING_HOST = "https://showflow.pro";

/** Only documents that exist. The DPA is a request, not a download, because
 *  there is no published PDF to link to. */
export const DOCUMENTS: TrustDocument[] = [
  {
    title: "Privacy policy",
    meta: "Web · updated May 28, 2026",
    href: `${APP_HOST}/privacy`,
    cta: "Read",
  },
  {
    title: "Terms of service",
    meta: "Web · updated May 2026",
    href: `${MARKETING_HOST}/terms`,
    cta: "Read",
  },
  { title: "Imprint", meta: "Web · § 5 DDG", href: `${APP_HOST}/impressum`, cta: "Read" },
  {
    title: "Subprocessor list",
    meta: "Section 5 of the privacy policy · 6 entries",
    href: `${APP_HOST}/privacy`,
    cta: "Read",
  },
  {
    title: "Data processing agreement",
    meta: "On request · Art. 28 GDPR",
    href: "mailto:contact@showflow.pro?subject=Data%20processing%20agreement",
    cta: "Request",
  },
];

export const TRUST_CONTACT = "contact@showflow.pro";

/** Shown next to the documents list. There is no gate, and we say so. */
export const DOCUMENTS_NOTE = "No form, no NDA, no email gate.";
