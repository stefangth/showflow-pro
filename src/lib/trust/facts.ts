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

/** The cross-organisation answer, stated once for all three roles.
 *
 *  Written narrowly on purpose. "A restrictive policy on every table" is not
 *  true and the evidence this page cites says so out loud:
 *  supabase/tests/rls/org_coverage.sql:11-19 lists four org_id-carrying
 *  tables it deliberately excludes from the org_isolation assertion. A
 *  reviewer who greps org_isolation finds fewer tables than "every" promises
 *  and stops trusting the rest of the page. The answer itself does not move:
 *  all four still refuse the cross-organisation read, by a different
 *  mechanism, and this says which. */
const NO_CROSS_ORG_NOTE =
  "A restrictive policy blocks the read on every table that carries your organisation's records. " +
  "Four sit outside it by name: membership and invitation rows, which are checked against the same " +
  "organisation instead because gating them on the membership they define would be circular, and two " +
  "platform logs no organisation member can read at all.";

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
    producer: {
      value: "Full",
      tone: "full",
      note: "Every hire order in this organisation, fee included. Issuing and voiding are separate sensitive rights.",
    },
    artist: { value: "Own order", tone: "scoped", note: "Your own hire order and its PDF only." },
  },
  {
    object: "Show-date chat",
    // is_chat_participant() returns true for any org admin or producer on any
    // chat in their org, and the INSERT policy calls the same function — so
    // neither role is read-only nor participant-limited.
    //
    // The archive window is an interface rule layered on top of that grant, and
    // it is not symmetric: ChatPanel.tsx:141 returns a placeholder instead of
    // the messages for every non-admin once the show date is more than
    // CHAT_ARCHIVE_DAYS old, while an admin keeps the thread with the composer
    // disabled (ChatPanel.tsx:160,187-193). ChatsListPage.tsx:33 drops it from
    // the list for everyone. An earlier draft said the archive "only hides it
    // from the chats list", which was false on both counts.
    admin: {
      value: "Full",
      tone: "full",
      note: "Any thread in this organisation. The database sets no time limit; 30 days after the show date the interface turns the thread read-only.",
    },
    producer: {
      value: "Full",
      tone: "full",
      note: "Any thread in this organisation. The database sets no time limit; 30 days after the show date the interface stops showing the thread.",
    },
    artist: { value: "Own dates", tone: "scoped", note: "Only threads for dates you are cast on." },
  },
  {
    object: "Booking audit log",
    // Both roles hold the same SELECT and INSERT policies, so they get the
    // same answer. See supabase/migrations/20260416115633_d565d983-e98a-468a
    // -a272-cbac9f2bdb89.sql:267-273 for the symmetric SELECT grants.
    admin: {
      value: "Append-only",
      tone: "scoped",
      note: "Reads every row and appends new ones. No policy allows altering or deleting a row.",
    },
    producer: {
      value: "Append-only",
      tone: "scoped",
      note: "Reads every row and appends new ones. No policy allows altering or deleting a row.",
    },
    artist: { value: "No access", tone: "none", note: "Not exposed." },
  },
  {
    object: "Another organisation's data",
    // "Every table" was false and its own cited evidence said so:
    // supabase/tests/rls/org_coverage.sql:11-19 names four org_id-carrying
    // tables deliberately outside the org_isolation assertion. The outcome
    // still holds on all four, which is why the value stays "No access":
    // org_memberships / org_invitations are gated on is_org_member and
    // has_org_role for the same org (20260603120000_add_platform_tables_and
    // _org_helpers.sql:85-93), and platform_audit_log
    // (20260723002902_platform_audit_log.sql:16-19) and email_send_log
    // (20260710231816_email_delivery_tables.sql:65) grant SELECT to
    // super-admins only, so no organisation member reads either one at all.
    // The note now states the mechanism a reviewer will actually find.
    admin: { value: "No access", tone: "none", note: NO_CROSS_ORG_NOTE },
    producer: { value: "No access", tone: "none", note: NO_CROSS_ORG_NOTE },
    artist: { value: "No access", tone: "none", note: NO_CROSS_ORG_NOTE },
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

/** Mirrors section 5 of docs/legal/privacy-policy.en.md. Asserted by test.
 *  Sentry and PostHog are "Off": the consent toggles exist in the UI, but
 *  neither SDK is in the dependency tree today, so nothing is loaded even
 *  after consent. Flip both to "Consent" the day the packages ship.
 *
 *  Google is here because the hero promises "every outside processor that
 *  ever touches it" and this page's own network tab falsified that: both
 *  index.html files load Geist and Geist Mono from fonts.googleapis.com and
 *  fonts.gstatic.com (app index.html:32-34, landing index.html:53-55),
 *  unconditionally and before the consent banner is answered, so Google LLC
 *  receives every visitor's IP address and user agent on the trust page
 *  itself. Naming it is the honest reading of the claim; the alternative is
 *  to self-host the two families and drop this row. Status is "Core" because
 *  no consent gate stands in front of it today, not because a webfont is
 *  strictly necessary.
 *
 *  Vercel appears twice, as two rows with two statuses, because one company
 *  runs two things here on two different legal bases and a single row could
 *  only tell the truth about one of them. Hosting is unconditional. Vercel
 *  Web Analytics is a separate product with its own package: the landing
 *  repo's src/App.tsx imports `@vercel/analytics/react` and renders
 *  `{analyticsOn && <Analytics />}`, where `analyticsOn` follows
 *  `readConsent() === "accept"` from src/components/CookieBanner.tsx. So no
 *  beacon fires before the banner is answered and none fires at all if it is
 *  rejected, but one does fire on the trust page once a reader accepts. That
 *  is exactly what "Consent" means in this column, and it is the status
 *  Sentry and PostHog take the day their SDKs ship. It runs on the public
 *  showflow.pro website only, never inside the application, which is why the
 *  purpose column names the site. */
export const SUBPROCESSORS: Subprocessor[] = [
  { name: "Supabase", purpose: "Database, authentication, storage", region: "EU · US", transfer: "EU region in use · DPF + SCCs", status: "Core", tone: "full" },
  { name: "Vercel", purpose: "Application hosting, edge network", region: "EU · US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Vercel Web Analytics", purpose: "Page-view analytics on the showflow.pro website", region: "EU · US", transfer: "DPF + SCCs", status: "Consent", tone: "gated" },
  { name: "Resend", purpose: "Transactional email", region: "US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Google", purpose: "Web fonts (Geist, Geist Mono)", region: "US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Sentry", purpose: "Client error reports", region: "EU · US", transfer: "EU region where available · SCCs", status: "Off", tone: "none" },
  { name: "PostHog", purpose: "Analytics, session replay", region: "EU · US", transfer: "EU region where available · SCCs", status: "Off", tone: "none" },
  { name: "Airtable", purpose: "Show-data sync", region: "US", transfer: "DPF + SCCs", status: "Off", tone: "none" },
];

/** Derived, never hand-typed: the KPI tile and the documents-list meta line
 *  both print this, and both must move automatically the day a processor is
 *  added, removed, or its consent status changes.
 *
 *  The second half counts "Off", not "Consent". When "Consent" was an empty
 *  set that choice was forced; it is still the right one now that Vercel Web
 *  Analytics fills it, because "not in use" is the number a reviewer scanning
 *  the hero actually needs, and the one the table two sections down would
 *  otherwise contradict. A consented processor is in use, so it is counted on
 *  the named side and not discounted on the second. */
export const SUBPROCESSOR_SUMMARY = `${SUBPROCESSORS.length} named, ${
  SUBPROCESSORS.filter((s) => s.status === "Off").length
} not in use`;

export interface Kpi {
  icon: string;
  label: string;
  value: string;
}

/** Where the Postgres project lives, stated once.
 *
 *  It was the KPI's value and, separately, a `value="EU · Ireland"` JSX literal
 *  in OrgDataCard.tsx, which is outside trust.json and therefore outside every
 *  drift gate: move the project and the in-app tab keeps publishing the old
 *  region while the public page it links to publishes the new one, with CI
 *  green. Both render this constant now, and factsSingleSource.test.ts fails if
 *  a component retypes the region instead of importing it. */
export const DATABASE_REGION = "European Union (Ireland)";

/** The four facts a reviewer scans first. Each is checkable. */
export const TRUST_KPIS: Kpi[] = [
  { icon: "lock", label: "Tenant isolation", value: "Row-level, asserted on every pull request" },
  // Scoped to the database on purpose. The Postgres project is eu-west-1, but
  // hosting and transactional email are US processors under DPF + SCCs, so a
  // bare "Data residency: EU" would overclaim. The subprocessor table carries
  // the per-processor regions.
  { icon: "globe", label: "Database region", value: DATABASE_REGION },
  { icon: "server", label: "Subprocessors", value: SUBPROCESSOR_SUMMARY },
  { icon: "users", label: "Access control", value: "28 rights, 9 sensitive, 9 off by default" },
];

/** The backup deletion ceiling, as one number.
 *
 *  It governs three printed sentences: the Backups retention period, the
 *  Backups control, and the footnote both in-app cards carry under "what
 *  happens when you delete something". Two of those were hand-retyped JSX
 *  ("Deleted data leaves the backups within 30 days…", "Backups age out
 *  within 30 days…"), which put the figure outside trust.json and outside
 *  every gate: lower the ceiling and the Settings tab keeps publishing 30
 *  while the public page publishes the new number. */
const BACKUP_MAX_DAYS = 30;

/** The backup claim, stated once and rendered by every surface that makes it.
 *  Composed into CONTROLS below, and imported directly by RetentionCard and
 *  YourDataCard. */
export const BACKUP_CEILING_NOTE =
  `Backups are retained no longer than ${BACKUP_MAX_DAYS} days, so data deleted from the live database leaves them inside that window. ` +
  `That is a deletion ceiling, not a promise that ${BACKUP_MAX_DAYS} days of restore points are kept.`;

export interface RetentionRow {
  item: string;
  period: string;
  /** What applies the period. Every row of this table used to print a bare
   *  figure, which reads as "a timer deletes this on that schedule" — and for
   *  five of the eight rows no such timer exists anywhere in the repo. Rather
   *  than drop the rows (they are the periods the policy commits to, and the
   *  commitment is real), each one now says which it is: a mechanism in the
   *  product, a setting held by a provider, or a commitment with nothing
   *  scheduled behind it. retentionBasis.test.ts pins the numbers quoted here
   *  to the code they name and re-derives the "nothing scheduled" half from
   *  the migrations, so a prune job added later turns this red instead of
   *  leaving a stale concession published. */
  basis: string;
}

/** Mirrors section 7 of docs/legal/privacy-policy.en.md. Asserted by test.
 *  The first three are the ones people actually ask about; the summary view
 *  on the public page shows only those.
 *
 *  Defined ahead of CONTROLS so the Auditability control can quote this
 *  table's own retention period instead of restating it as a second literal. */
export const RETENTION: RetentionRow[] = [
  {
    item: "Bookings and audit log",
    period: "3 years from show date",
    basis:
      "A policy commitment. No scheduled job deletes these rows; they go when the organisation itself is deleted (delete_org).",
  },
  {
    item: "Show-date chat",
    // Two claims in one row, and only the first has a mechanism. Keeping them
    // in one row matches section 7's single chat bullet; the basis is what
    // separates them.
    period: "Archived 30 days · deleted 12 months",
    basis:
      "The 30 day archive is enforced by the application (CHAT_ARCHIVE_DAYS in src/config/app.config.ts). The 12 month deletion is a policy commitment; no scheduled job performs it.",
  },
  // A ceiling, not a window. The Supabase organisation behind this deployment
  // is on the free plan, which carries no restorable daily-backup window at
  // all (daily backups start at Pro, and 30 days of them needs Enterprise or
  // the PITR add-on). "Rolling 30 days" read as a durability promise nobody
  // could keep. What is true, and what section 7 now states, is the deletion
  // ceiling: nothing the provider holds outlives 30 days.
  {
    item: "Backups",
    period: `No longer than ${BACKUP_MAX_DAYS} days`,
    basis: "Set by the managed database provider. Nothing in this codebase writes or expires a backup.",
  },
  {
    item: "Account and profile",
    period: "Life of account + 30 days",
    basis:
      "Deletion runs on request: the delete-my-account function anonymises what booking records must keep, then removes the login. The 30 days is the backup ceiling above.",
  },
  {
    // The one row where the published figure and the deployed configuration
    // pointed in opposite directions. Section 7 states 24 months and the page
    // printed it as though something held the rows for that long; what
    // actually exists is prune_email_log, a nightly job that deletes
    // email_send_log at email_log_retention_days (seeded to 90), and no prune
    // at all on suppressed_emails. Both facts sit inside a 24-month ceiling,
    // so the number stays and the basis says which side of it each half is on.
    item: "Email send log and suppressions",
    period: "24 months",
    basis:
      "A ceiling, not a schedule. The send log is pruned nightly at a shorter configured window (prune_email_log, email_log_retention_days, 90 days by default). The suppression list has no scheduled prune, so 24 months is a commitment for it.",
  },
  {
    item: "Hosting and database logs",
    period: "7–30 days",
    basis: "Set by the hosting and database providers. Nothing in this codebase retains or expires these logs.",
  },
  // Sentry and PostHog are "Off" (see SUBPROCESSORS below): neither SDK ships
  // today, so nothing is collected yet. The periods below are what the
  // privacy policy commits to for the day either is switched on, not a
  // description of current collection — the qualifier says so rather than
  // publishing a live-sounding number for a control that is not live.
  //
  // The second qualifier names PostHog rather than saying "once analytics is
  // enabled", which was false the moment Vercel Web Analytics was disclosed:
  // analytics IS enabled on the public site, after consent, on this very
  // page. What is not enabled is PostHog's product analytics and session
  // replay, and that is the pair this 12-month commitment (section 7) covers.
  // Vercel Web Analytics has no row here because it has no row in section 7:
  // it is page-view data on the marketing site, described in section 5, and
  // inventing a retention figure for it would be a claim with no artefact
  // behind it.
  {
    item: "Error reports",
    period: "90 days, once error tracking is enabled",
    basis: "A policy commitment. No error-tracking package ships in the application, so nothing is collected.",
  },
  {
    item: "Analytics and session replay",
    period: "12 months, once PostHog is enabled",
    // Narrow on purpose, and for the reason the comment block above already
    // documents for the *period*: a bare "so nothing is collected" is
    // falsified by scrolling two sections up on this same page, where the
    // subprocessor table lists Vercel Web Analytics at status "Consent" and
    // the landing repo's src/App.tsx mounts it on this very route once a
    // reader accepts. Page-view analytics IS collected here. What is not is
    // PostHog's product analytics and session replay, which is the pair this
    // row covers, so that is what the sentence denies. retentionBasis.test.ts
    // re-derives the premise from SUBPROCESSORS and fails on the blanket
    // wording.
    basis:
      "A policy commitment. No PostHog package ships in the application, so no product analytics or session replay is collected.",
  },
];

/** Shown above the table on both surfaces, so a reader knows what the second
 *  line under each period is for. */
export const RETENTION_BASIS_NOTE =
  "The note under each period says what applies it: a mechanism in the product, a setting held by a provider, or a commitment with nothing scheduled behind it.";

/** The one concession this page makes about enforcement, stated once.
 *
 *  It was hand-written three times — here, in CapabilitiesCard.tsx, and as a
 *  JSX literal in the landing repo's Trust.tsx, which is outside trust.json
 *  and therefore outside every drift gate. That is the worst possible claim
 *  to duplicate: the day one of those three rights gains a database policy,
 *  the public page keeps publishing a gap that has been closed, with CI
 *  green. It now ships in the contract as `capabilities.note`
 *  (scripts/build-trust-json.mjs) so both surfaces render the same string.
 *
 *  Both renderers used to introduce it with "Most are checked in the database
 *  on write", which turned naming three exceptions into a claim that the
 *  other 25 carry a database policy. They do not: six are checked only by an
 *  edge function (invite_artists, run_offer_engine, resend_account_invite,
 *  generate_hire_orders, issue_hire_orders, trigger_sync), which is
 *  server-side but not "in the database", and this sentence's own wording
 *  makes that difference load-bearing. So the split is stated in full here
 *  and the lead-in is gone from both surfaces.
 *
 *  The three-way split — 19 in the database, 6 edge-only, 3 interface-only —
 *  is recomputed from the registry, the migrations and the edge tree by
 *  capabilityEnforcement.test.ts, which fails if any of the three numbers or
 *  the named interface-only set moves. facts.ts cannot import
 *  capabilities.ts (the trust.json loader rejects any import here), so a test
 *  is the only place the count can be pinned.
 *
 *  "In the database" covers two shapes, and the sentence names both because
 *  18 of the 19 are the first and one is the second: an is_capability_enabled
 *  call in the row-level policy that guards the write, or the same call
 *  inside the SECURITY DEFINER function that performs it — rename_org, which
 *  bypasses RLS by design, is gated in its own body
 *  (20260723191933_rpc_capability_gates.sql). Calling all 19 "a database
 *  policy" would have repeated the finding's mistake one level down. */
export const CAPABILITY_INTERFACE_ONLY_NOTE =
  "25 of the 28 rights are checked on the server: 19 inside the database, by the row-level policy that guards the write or by the function that performs it, and 6 more by an edge function that asks the same database check before it acts. The remaining three reorder or archive the production catalog and edit its scheduling; only the interface enforces those.";

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
    // "One restrictive database policy per table" said more than the cited
    // test does: org_coverage.sql names four org_id-carrying tables it
    // excludes on purpose. Naming them here costs a clause and keeps the
    // claim checkable against the file it points at. See NO_CROSS_ORG_NOTE.
    claim:
      "Every table holding your data carries its organisation, down to individual chat messages and audit rows. One restrictive database policy on each of them means a session reads only organisations it belongs to. Four tables sit outside that policy by name, and refuse the cross-organisation read another way: membership and invitation rows are checked against the same organisation, and two platform logs are readable by no organisation member. Restrictive policies filter; they never grant.",
    evidence:
      "supabase/tests/rls/org_isolation.sql asserts org A reads and writes zero rows of org B on shows and show_dates, even holding a global producer role. supabase/tests/rls/org_coverage.sql confirms the same restrictive policy exists on every table in its list, including chat_messages and booking_audit_log, and names the four it excludes with the reason for each. Both run on every pull request.",
  },
  {
    icon: "users",
    title: "Roles and rights",
    // The "two nines are different sets" clause lives in `claim`, not
    // `evidence`, on purpose: the public page renders `evidence` only in Full
    // inventory mode, and Summary is what a reviewer lands on. Left in
    // `evidence` it produced exactly the conflation this build exists to kill:
    // two nines side by side reading as one set.
    claim:
      `Three roles per organisation. Every read is authorised in the database. ${CAPABILITY_INTERFACE_ONLY_NOTE} Nine rights are marked sensitive and ask for a second confirmation before they take effect. Nine ship switched off until an administrator turns them on. The two nines are different sets: issuing and voiding hire orders are sensitive yet ship on, because a production team that cannot issue an order cannot work.`,
    evidence:
      "28 rights across 8 groups, declared in src/lib/capabilities.ts and folded into the inventory this page prints.",
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
    // "Booking changes are appended to a log: who acted, what changed" said
    // more than the trigger does. public.notify_booking_transition returns
    // without writing unless TG_OP is UPDATE and OLD.status <> NEW.status, so
    // an INSERT is never logged and an edit to notes, cancellation_reason,
    // is_understudy or response_deadline leaves no row; "what changed" is
    // only old_status -> new_status. performed_by is auth.uid(), which is
    // NULL for a server-side write, and the automated understudy promotion
    // (public.promote_understudy_on_cancellation) passes NULL explicitly, so
    // "who acted" is frequently absent rather than always present. The claim
    // now says exactly that, including the part that is a limitation.
    title: "Auditability",
    claim:
      "Every change to a booking's status is appended to a log: the old status, the new status, who acted, and when. Automated transitions, such as an understudy promoted after a cancellation, are appended the same way, with no person to record as the actor. Nothing else about a booking is logged: editing its notes leaves no row. Administrators and the production team can read the log; no policy on the table permits an update or a delete.",
    evidence: `Written by the notify_booking_transition trigger, which returns without writing unless the status actually changed, and by promote_understudy_on_cancellation for the automated path. Retained ${RETENTION.find((r) => r.item === "Bookings and audit log")!.period}, per section 7 of the privacy policy.`,
  },
  {
    icon: "shield",
    title: "Application security",
    claim:
      "Role checks run as security-definer database functions rather than being scattered through queries. Every pull request is scanned for committed secrets, and dependency updates arrive as grouped weekly pull requests.",
    evidence:
      "Checks concentrated in has_org_role, is_org_member, is_capability_enabled, is_feature_enabled, and capability_default: one place to audit.",
  },
  {
    icon: "database",
    title: "Backups",
    claim: `Managed Postgres, hosted by Supabase. ${BACKUP_CEILING_NOTE}`,
    evidence: "Stated in section 7 of the privacy policy.",
  },
];

export const TRANSFER_BASIS_NOTE =
  "Adequacy decision of 10 July 2023 (EU–US Data Privacy Framework) or the Standard Contractual Clauses of 4 June 2021, with encryption in transit and at rest.";

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
    detail:
      "A machine-readable export of your profile, memberships, bookings, blocked dates, messages and notifications, from your profile page. Art. 15 and 20.",
  },
  {
    icon: "eye",
    // This detail used to read "Turns off analytics, session replay, and
    // error tracking if and when any of them is enabled", which told a reader
    // of this page that no analytics was running while a page-view beacon was
    // running on the page they were reading it on. The two surfaces have two
    // separate consent stores and two separate controls, and only one of them
    // has anything to switch off today, so the string now names both rather
    // than averaging them into something true of neither.
    title: "Withdraw analytics consent",
    detail:
      "On showflow.pro, Cookie settings in the footer stops the page-view analytics that loads only after you accept. In the app, Manage cookie preferences turns off analytics, session replay, and error tracking if and when any of them is enabled. Art. 7(3).",
  },
  {
    icon: "alert",
    title: "Delete your account",
    detail: "Removes your account and anonymises what must be retained for booking records, from your profile page. Art. 17.",
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
    // The meta names the scope because two documents called "Privacy policy"
    // are reachable from the public Trust page: this one, and the marketing
    // site's, which the shared footer links to. They are different documents
    // with different dates. This one opens "how ShowFlow Pro collects, uses,
    // and shares personal data when you use the ShowFlow Pro web application
    // and related transactional emails"; the site policy opens "The data
    // controller for this website (showflow.pro)". A reviewer establishing
    // which statements are authoritative should not have to guess.
    //
    // The date is printed in the document's own format ("11 August 2026") so
    // the assertion against it is a string containment rather than a
    // reformatting step that could quietly stop matching. It was a hand-typed
    // literal nobody checked; facts.privacy.test.ts now parses the policy's
    // `_Last updated:_` line and fails if the two disagree, and pins the
    // German twin's `_Stand:_` to the same day.
    meta: "Web · covers the app, not the showflow.pro website · updated 11 August 2026",
    href: `${APP_HOST}/privacy`,
    cta: "Read",
  },
  {
    title: "Terms of service",
    // The terms live in the landing repo (src/pages/Tos.tsx, "Last updated
    // May 15, 2026"), which nothing in this repo can read — so this date was
    // the one printed figure on the page with no gate at all, and it was
    // rounded to the month on top of that. It now names the document's own
    // day, and the landing repo's scripts/check-doc-dates.mjs (chained onto
    // its blocking `npm run lint`) parses Tos.tsx and fails if the published
    // contract stops matching it.
    meta: "Web · updated 15 May 2026",
    href: `${MARKETING_HOST}/terms`,
    cta: "Read",
  },
  { title: "Imprint", meta: "Web · § 5 DDG", href: `${APP_HOST}/impressum`, cta: "Read" },
  {
    title: "Subprocessor list",
    meta: `Section 5 of the privacy policy · ${SUBPROCESSORS.length} entries`,
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

/** Shown next to the documents list. Everything but the DPA is a public web
 *  page; the DPA is a reply by email, not a download form, and this says so
 *  rather than claiming no document here ever requires an email. */
export const DOCUMENTS_NOTE = "Everything below is public. The DPA is a reply by email, not a download form.";

/** The date the claims on this page were last reviewed, in `YYYY-MM-DD`
 *  form. Bump this by hand in the same commit as any change to a claim
 *  table in this file or to `src/lib/capabilities.ts`.
 *
 *  Deliberately NOT derived from `git log` (a commit date is only assigned
 *  when `git commit` runs, which is after `sync:mirrors` has already
 *  written this file into the commit, so the two can never agree byte for
 *  byte — see the `generatedAt` finding). A hand-bumped value lives in the
 *  tree, survives rebase/amend/squash, and stays stable under repeated
 *  `--check` runs, which is what the drift gate needs. */
export const FACTS_LAST_REVIEWED = "2026-08-11";
