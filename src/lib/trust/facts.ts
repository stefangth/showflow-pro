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
  /** The mechanism — why the answer is what it is.
   *
   *  HELD TO 110 CHARACTERS, and pinned there by factsDensity.test.ts. Both
   *  surfaces now lay this table out `fixed` with a declared Mechanism width
   *  and one row height for all eight rows, and 110 characters is what fits
   *  two lines in the narrowest column either surface gives it. A longer cell
   *  does not squeeze its neighbours any more — it silently grows one row and
   *  breaks the rhythm the fixed layout exists to produce. Detail that will
   *  not fit goes under the table as a footnote, the way
   *  CROSS_ORG_EXCEPTIONS_NOTE does. */
  note: string;
  /** Set when this cell's mechanism has a qualifier that will not fit in a
   *  table cell, and is published as CROSS_ORG_EXCEPTIONS_NOTE below the
   *  matrix instead. A renderer that ignores this flag prints "every table
   *  that carries your organisation's records" with nothing pointing at the
   *  four exceptions, which is the over-claim the note exists to prevent — so
   *  both surfaces mark the cell and associate it with the note. */
  qualifiedByExceptionsNote?: boolean;
}

export interface MatrixRow {
  object: string;
  admin: AccessCell;
  producer: AccessCell;
  artist: AccessCell;
}

/** The cross-organisation answer, stated once for all three roles.
 *
 *  One clause, because this is a table cell. Both surfaces USED TO lay the
 *  matrix out `auto`, so the widest Mechanism cell took the width: carrying
 *  the exclusion list here as well made this cell 54 words against 3-15
 *  everywhere else, which collapsed the Data column to 147px in the app and
 *  wrapped five of eight row labels. Both are `fixed` now (see AccessCell.note
 *  above), so an over-long cell no longer starves its neighbours — it breaks
 *  the row rhythm instead, which is why the 110-character cap replaced the
 *  self-policing the auto layout used to provide. Either way the qualifier is
 *  not dropped — it is CROSS_ORG_EXCEPTIONS_NOTE below, rendered under the
 *  table. */
const NO_CROSS_ORG_NOTE =
  "A restrictive policy blocks the read on every table that carries your organisation's records.";

/** The exclusions behind NO_CROSS_ORG_NOTE, published as a footnote under the
 *  matrix rather than inside a cell.
 *
 *  It has to be published somewhere. "A restrictive policy on every table" is
 *  not true and the evidence this page cites says so out loud:
 *  supabase/tests/rls/org_coverage.sql:11-19 lists four org_id-carrying tables
 *  it deliberately excludes from the org_isolation assertion. A reviewer who
 *  greps org_isolation finds fewer tables than "every" promises and stops
 *  trusting the rest of the page. The answer itself does not move: all four
 *  still refuse the cross-organisation read, by a different mechanism, and
 *  this says which. */
export const CROSS_ORG_EXCEPTIONS_NOTE =
  "Four tables sit outside that restrictive policy by name: membership and invitation rows, which are " +
  "checked against the same organisation instead because gating them on the membership they define " +
  "would be circular, and two platform logs no organisation member can read at all.";

/** Who can read what, and the mechanism that decides it.
 *  Each cell is asserted against the RLS policy that produces it. */
export const VISIBILITY_MATRIX: MatrixRow[] = [
  {
    object: "Artist contact details",
    admin: { value: "Full", tone: "full", note: "Every artist record in this organisation." },
    // The quoted string is the LABEL Settings > Roles and permissions shows,
    // not the action key behind it: a reader told to look for "edit artists"
    // finds no such row. publishedClaims.test.ts pins every quoted right in
    // this table to a CAPABILITY_DEFS label.
    producer: { value: "Full", tone: "full", note: 'Editing needs the "Edit artist details, skills, and status" right.' },
    artist: { value: "Own record", tone: "scoped", note: "A row-level policy limits reads to your own profile." },
  },
  {
    object: "Availability and blocked dates",
    admin: { value: "Full", tone: "full", note: "Needed to route dates." },
    producer: { value: "Full", tone: "full", note: "Needed to route dates." },
    // "nobody outside the organisation reads them" was the one absolute in
    // this table that reached past the three roles the table declares, and it
    // is false. `public.is_org_member` opens `select public.is_super_admin(_uid)
    // or …` (20260603120200_org_isolation_rls.sql:18-23), so the RESTRICTIVE
    // org_isolation policy does not filter a platform administrator, and
    // `public.has_org_role` opens the same way
    // (20260603120000_add_platform_tables_and_org_helpers.sql:64-69), so the
    // permissive "Admins and producers can view blocked_dates" SELECT policy
    // admits one too. `blocked_dates` carries no compensating predicate. The
    // repo asserts the equivalent affirmatively one table over:
    // supabase/tests/rls/artists_contact_privacy.sql:88 proves a super-admin
    // CAN read an artist's email.
    //
    // Dropping the ShowFlow-staff column from this table is silence, and
    // silence is fine. An affirmative "nobody" is a claim. So the denial is
    // scoped to the population the table is about — other organisations'
    // members — which is exactly what org_isolation delivers.
    // publishedClaims.test.ts re-derives the premise from those two helpers
    // and rejects an absolute quantifier anywhere in the published claims, so
    // this cannot come back a third time.
    artist: { value: "Own dates", tone: "scoped", note: "You declare them; no other organisation's members read them." },
  },
  {
    object: "Booking status and offers",
    admin: { value: "Full", tone: "full", note: "Across every production." },
    producer: { value: "Full", tone: "full", note: 'Confirming needs the "Confirm bookings" right.' },
    artist: { value: "Own offers", tone: "scoped", note: "You see your own tier, never another artist's." },
  },
  {
    // "Booking notes and cancellation reasons" was the widest label in the
    // table by 66px and the only one that wrapped once the columns were fixed.
    // "Booking" is carried by the two rows above it ("Booking status and
    // offers", "Booking audit log") and by every mechanism cell in this row,
    // so dropping it costs no precision: these are still the `notes` and
    // `cancellation_reason` columns on `bookings` and nothing else.
    object: "Notes and cancellation reasons",
    admin: { value: "Full", tone: "full", note: "Free text written by the production team." },
    producer: { value: "Full", tone: "full", note: "Free text written by the production team." },
    // Honest correction to the source design, which claimed "No access". These
    // are columns on `bookings`, and the artist's own-row SELECT policy returns
    // the whole row. The interface does not draw them; the API does return them.
    artist: {
      value: "Own booking",
      tone: "scoped",
      note: "Fields on your own booking row, returned with it. Another artist's never are.",
    },
  },
  {
    // The only row on this table describing a module an organisation may not
    // have. `hire_orders` ships with `defaultEnabled: false`
    // (src/lib/entitlements.ts), so for most organisations these three answers
    // describe nothing that exists — and the in-app tab bills itself as
    // "narrowed to the organisation you are signed in to" (TrustDataTab.tsx),
    // which makes an unmarked row read as a statement about the reader's own
    // workspace. That is what the `gated` tone is for, and it was a dead
    // branch on both surfaces until this row used it: it is the third answer
    // this column can give, alongside access and no access, and it means "only
    // if this is switched on for you".
    //
    // The condition is repeated in all three cells rather than footnoted,
    // because the role picker shows exactly ONE of them at a time — a reader
    // never sees the repetition, and a reader who lands on the artist column
    // must not be the one who misses it.
    object: "Hire-order fees",
    admin: {
      value: "Full",
      tone: "gated",
      note: "Only if your organisation turns on hire orders. Letterhead, numbering, and terms included.",
    },
    producer: {
      value: "Full",
      tone: "gated",
      note: "Only if your organisation turns on hire orders. Every order and fee; issuing and voiding are sensitive.",
    },
    // "Your own hire order and its PDF only" was wider than the policy that
    // produces it: "Artists read own issued orders"
    // (20260717102508_hire_orders_schema.sql:108-113) restricts the SELECT to
    // `status in ('issued','countersigned')`, so a draft of your own order is
    // invisible to you. "once it is issued" is the qualifier that makes the
    // sentence true of the policy.
    artist: {
      value: "Own order",
      tone: "gated",
      note: "Only if your organisation turns on hire orders. Your own order and its PDF, once it is issued.",
    },
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
    //
    // Both notes were 135 characters, the two longest cells in the table by
    // 33, and the pair that decided its row height at every width. They are
    // now 98 and 96, holding all three facts: the scope ("Every thread"), the
    // absence of a database time limit, and the asymmetric interface rule.
    // "in this organisation" is dropped from the scope clause because the
    // Access value beside it already says "Full" and the whole table is
    // org-scoped by its own last row.
    admin: {
      value: "Full",
      tone: "full",
      note: "Every thread, no database time limit. The interface turns it read-only 30 days after the show date.",
    },
    producer: {
      value: "Full",
      tone: "full",
      note: "Every thread, no database time limit. The interface stops showing it 30 days after the show date.",
    },
    artist: { value: "Own dates", tone: "scoped", note: "Only threads for dates you are cast on." },
  },
  {
    object: "Booking audit log",
    // Both roles hold the same SELECT and INSERT policies, so they get the
    // same answer. The citation this comment used to carry pointed at code
    // deleted in June: the two SELECT grants were created at
    // 20260416115633_d565d983-e98a-468a-a272-cbac9f2bdb89.sql:268-274 (the old
    // line range was off by one at both ends — 267 is blank and 273 truncates
    // the producer policy), but both were DROPped and recreated with
    // has_org_role by the programmatic rewrite in
    // 20260603130200_org_scoped_role_gating.sql:16-48, and the
    // has_role(uuid, app_role) they called was dropped outright at
    // 20260603150000_drop_user_roles_and_has_role.sql:26. The live pair is
    // whatever that rewrite produced, so the rewrite is what a reviewer has to
    // read; the original is cited only as its input.
    //
    // "No policy allows altering or deleting a row" was true and read as
    // immutability, which the system does not deliver. THREE paths change a
    // row, and an earlier fix for this finding named only two, because it
    // looked for SQL written by hand and the third is written by referential
    // integrity:
    //
    //  1. `anonymize_user` UPDATEs performed_by to NULL
    //     (20260723183038_hire_order_user_fks_set_null.sql:32). SECURITY
    //     DEFINER, reachable by ANY user deleting their own account.
    //  2. `delete_org` DELETEs the rows (20260622193255_delete_org.sql:13).
    //  3. Deleting a SHOW DATE. `booking_audit_log.booking_id` is
    //     `REFERENCES public.bookings(id) ON DELETE SET NULL`
    //     (20260416115633_…:254) and `bookings.show_date_id` is
    //     `REFERENCES public.show_dates(id) ON DELETE CASCADE` (:224), so the
    //     cascade deletes the bookings and RI then performs an UPDATE on every
    //     audit row they own. No hand-written SQL is involved, no guard
    //     trigger stands in the way, and the UI opens the door: `bookingCount`
    //     in ShowDateDetailSheet.tsx:367 excludes cancelled bookings, so a
    //     manual date whose bookings are all cancelled looks empty and
    //     `canHardDeleteDate` enables Delete — while the cancellations are
    //     exactly what notify_booking_transition wrote audit rows for. It is
    //     user-visible: src/data/admin.ts:26 joins
    //     `booking:bookings(artist:artists(name))` and that join goes empty.
    //
    // This repo has been bitten by "RI's SET NULL is an UPDATE" before —
    // 20260717110023_hire_order_freeze_allow_null_on_delete.sql exists for
    // exactly that reason on another table. So the sentence names all three
    // and bookingAudit.test.ts derives BOTH shapes: function bodies and the
    // table's own foreign-key actions.
    admin: {
      value: "Append-only",
      tone: "scoped",
      note: "Reads every row and appends. Account, show-date and organisation deletions clear fields or remove rows.",
    },
    producer: {
      value: "Append-only",
      tone: "scoped",
      note: "Reads every row and appends. Account, show-date and organisation deletions clear fields or remove rows.",
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
    // has_org_role for the same org, lines 85-93 of
    // 20260603120000_add_platform_tables_and_org_helpers.sql, and platform_audit_log
    // (20260723002902_platform_audit_log.sql:16-19) and email_send_log
    // (20260710231816_email_delivery_tables.sql:65) grant SELECT to
    // super-admins only, so no organisation member reads either one at all.
    // The note now states the mechanism a reviewer will actually find.
    admin: { value: "No access", tone: "none", note: NO_CROSS_ORG_NOTE, qualifiedByExceptionsNote: true },
    producer: { value: "No access", tone: "none", note: NO_CROSS_ORG_NOTE, qualifiedByExceptionsNote: true },
    artist: { value: "No access", tone: "none", note: NO_CROSS_ORG_NOTE, qualifiedByExceptionsNote: true },
  },
];

export interface Subprocessor {
  name: string;
  purpose: string;
  region: string;
  transfer: string;
  /** "Core" runs for everyone, unconditionally. "Consent" runs only after a
   *  reader accepts in a cookie banner. "Optional" runs only for an
   *  organisation that has connected it, on no consent gate at all — the
   *  Airtable sync is server side and sets nothing on a device, so folding it
   *  into "Consent" would tell a reader to look for a toggle that does not
   *  exist, and folding it into "Core" would say every organisation's
   *  schedule is read out of Airtable. "Off" is kept for a processor that is
   *  named but processing nothing; no row uses it today. */
  status: "Core" | "Consent" | "Optional" | "Off";
  tone: AccessTone;
}

/** Mirrors section 5 of docs/legal/privacy-policy.en.md. Asserted by test.
 *
 *  PostHog and Airtable used to be "Off" and are not any more. The case for
 *  "Off" was the dependency tree — nothing was installed, so nothing could be
 *  loaded even after consent. The column asks a different question, though:
 *  whether a processor receives data, which is about the deployment and not
 *  about package.json, and the answer for both is yes. (posthog-js is now in
 *  the application's dependency tree; the consent-gated init is in
 *  src/features/analytics/.)
 *
 *  PostHog is therefore "Consent": it receives nothing — product analytics,
 *  session replay, or error reports — unless a reader accepts the matching
 *  category, which is the gate the consent banner and dialog record
 *  (src/components/consent/) and the basis sections 4(g), 4(h) and 4(j) of the
 *  privacy policy state. Airtable is "Optional":
 *  an organisation connects its own base and the sync then runs server side
 *  on a schedule (supabase/functions/airtable-poll/index.ts), with no cookie
 *  and nothing stored on a device, which is why it belongs in the privacy
 *  policy and not in a cookie notice.
 *
 *  Google is here because the hero promises to name every outside processor
 *  and this page's own network tab falsified that: both index.html files load
 *  the two web font families from fonts.googleapis.com and fonts.gstatic.com
 *  (app index.html:34-36, landing index.html:53-55), unconditionally and
 *  before the consent banner is answered, so Google LLC receives every
 *  visitor's IP address and user agent on the trust page itself. Naming it is
 *  the honest reading of the claim; the alternative is to self-host the
 *  families and drop this row. Status is "Core" because no consent gate
 *  stands in front of it today, not because a web font is strictly necessary.
 *  The purpose column does NOT name the typefaces: which families we serve is
 *  a detail about our stylesheet, not about the reader's data, and naming
 *  them on a trust page reads as precision spent in the wrong place.
 *
 *  Vercel appears twice, as two rows with two statuses, because one company
 *  runs two things here on two different legal bases and a single row could
 *  only tell the truth about one of them. Hosting is unconditional. Vercel
 *  Web Analytics is a separate product with its own package: the landing
 *  repo's src/App.tsx imports `@vercel/analytics/react` and renders
 *  `{analyticsOn && <Analytics />}`, where `analyticsOn` follows
 *  `readConsent() === "accept"` from src/components/CookieBanner.tsx. So no
 *  beacon fires before the banner is answered and none fires at all if it is
 *  rejected, but one does fire on the trust page once a reader accepts. It
 *  runs on the public showflow.pro website only, never inside the
 *  application, which is why the purpose column names the site. */
// The `transfer` column mirrors section 5's "Transfer mechanism" cell, and
// three rows used to differ from it in ways a reader would notice. Supabase's
// cell reads "EU storage option in use WHERE AVAILABLE", and dropping the hedge
// published a firmer commitment than the policy makes. PostHog's reads
// "EU region used where available; DPF and SCCs for US transfers", and
// naming only the SCCs dropped a transfer basis the policy asserts — an
// under-claim, but a divergence from the artefact all the same. The
// facts.privacy.test.ts assertion that should have caught it only checked one
// direction (page says DPF -> policy must too), so an omission was structurally
// invisible to it; it now compares both ways.
export const SUBPROCESSORS: Subprocessor[] = [
  { name: "Supabase", purpose: "Database, authentication, storage", region: "EU · US", transfer: "EU region in use where available · DPF + SCCs", status: "Core", tone: "full" },
  { name: "Vercel", purpose: "Application hosting, edge network", region: "EU · US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Vercel Web Analytics", purpose: "Page-view analytics on the showflow.pro website", region: "EU · US", transfer: "DPF + SCCs", status: "Consent", tone: "gated" },
  { name: "Resend", purpose: "Transactional email", region: "US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "Google", purpose: "Web fonts", region: "US", transfer: "DPF + SCCs", status: "Core", tone: "full" },
  { name: "PostHog", purpose: "Product analytics, session replay, error reports", region: "EU · US", transfer: "EU region where available · DPF + SCCs", status: "Consent", tone: "gated" },
  { name: "Airtable", purpose: "Show-data sync, for organisations that connect it", region: "US", transfer: "DPF + SCCs", status: "Optional", tone: "gated" },
];

/** Derived, never hand-typed: the KPI tile and the documents-list meta line
 *  both print this, and both must move automatically the day a processor is
 *  added, removed, or its status changes.
 *
 *  The second half used to count "Off" and print "not in use", which was the
 *  number a reviewer needed while three rows were named-but-processing-
 *  nothing. No row is, any more, so that half would print a zero: true, and
 *  useless. The split that is left is the one worth counting — how many of
 *  the eight run for everyone unconditionally, against how many run only
 *  after a reader accepts or an organisation connects them. Counting the
 *  unconditional side is also the conservative direction: a processor added
 *  without a status decision defaults to nothing, so it cannot silently
 *  inflate the reassuring number. */
export const SUBPROCESSOR_SUMMARY = `${SUBPROCESSORS.length} named, ${
  SUBPROCESSORS.filter((s) => s.status === "Core").length
} always on`;

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
  { icon: "users", label: "Access control", value: "29 rights, 9 sensitive, 9 off by default" },
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
    // The function name that used to close this sentence ("(delete_org)") was
    // the audit trail written into the published copy. It stays as an audit
    // trail — retentionBasis.test.ts still re-derives the claim from the SQL
    // that deletes these tables — but a reader of a trust page needs the
    // guarantee, not the identifier that implements it.
    basis:
      "A policy commitment. No scheduled job deletes these rows; they go when the organisation itself is deleted.",
  },
  {
    item: "Show-date chat",
    // Two claims in one row, and only the first has a mechanism. Keeping them
    // in one row matches section 7's single chat bullet; the basis is what
    // separates them.
    period: "Archived 30 days · deleted 12 months",
    // The constant name and its path used to ride in this sentence. The number
    // is still pinned to the constant by retentionBasis.test.ts, which is
    // where a pin belongs; what a reader needs is that the 30 days is applied
    // by the product and the 12 months is not applied by anything.
    basis:
      "The 30 day archive is applied by the product itself. The 12 month deletion is a policy commitment; no scheduled job performs it.",
  },
  // A ceiling, not a window. The Supabase organisation behind this deployment
  // is on the free plan, which carries no restorable daily-backup window at
  // all (daily backups start at Pro, and 30 days of them needs Enterprise or
  // the PITR add-on). "Rolling 30 days" read as a durability promise nobody
  // could keep. What is true, and what section 7 now states, is the deletion
  // ceiling: nothing the provider holds outlives 30 days.
  {
    item: "Backups",
    period: `${BACKUP_MAX_DAYS} days maximum`,
    basis: "Set by the managed database provider. Nothing we run writes or expires a backup.",
  },
  {
    item: "Account and profile",
    period: "Life of account + 30 days",
    basis:
      "Deletion runs on request: it anonymises what booking records must keep, then removes the login. The 30 days is the backup ceiling above.",
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
      "A ceiling, not a schedule. The send log is pruned nightly at a shorter configured window, 90 days by default. The suppression list has no scheduled prune, so 24 months is a commitment for it.",
  },
  {
    // "Nothing in this codebase retains or expires these logs" was true of
    // what this row is about — section 7's "Hosting / Supabase logs", which
    // are the providers' own — but the row is titled "Hosting and database
    // logs", and this repo does prune two operational tables whose names end
    // in _log: cron-health-watcher/index.ts:181-185 deletes
    // cron_health_dispatch after a day and cron_health_log after 30. Those are
    // not provider logs and are not what section 7 commits to, so the claim
    // was not false; it was ambiguous enough that a reviewer grepping for a
    // prune found one. The sentence now says whose logs it means, which costs
    // nothing and closes the reading.
    item: "Hosting and database logs",
    period: "7-30 days",
    basis: "These are the hosting and database providers' own logs, and they set the period. Nothing we run retains or expires them.",
  },
  // This row carried its condition in the `period` cell for a while
  // ("12 months, once PostHog is enabled"), then in the basis line as a denial
  // ("no package ships, so nothing is collected"). Both are gone. The period
  // is stated flat, because the processor is in use: the subprocessor table
  // above carries PostHog at status "Consent" (product analytics, session
  // replay, and error reports), and a retention table that hedged a period for
  // a processor the page discloses as live would contradict itself two
  // sections apart.
  //
  // WHAT THIS SENTENCE DELIBERATELY DOES NOT SAY. posthog-js is installed and
  // consent-gated (src/features/analytics/), but the basis still names no
  // client library, SDK, or mechanism — the trust page owes a reader the
  // processing and the gate, not the implementation. What it states instead
  // is the processing and the gate in front of it, both of which the privacy
  // policy asserts (sections 4(g), 4(h), 4(j) and 9) and the consent banner
  // and dialog in src/components/consent/ record.
  //
  // The Vercel Web Analytics row at the foot of this table used to have no
  // period at all, on the grounds that section 7 named none and inventing one
  // would be a claim with no artefact behind it. The gap was the wrong half
  // to leave open on a table a reader takes for a complete inventory, so
  // section 7 gained a bullet and this gained a row. Neither figure in it is
  // ours — both are quoted from Vercel's own documentation, which is what the
  // basis line says.
  {
    item: "Analytics, session replay and error reports",
    period: "12 months",
    // Scoped to the product-analytics processor (PostHog: page-view/feature
    // events, session replays, and the exception reports error tracking sends)
    // rather than to "analytics", because the page-view beacon on the public
    // website is a different processor with a different period and its own row
    // at the foot of this table. Collapsing the two would publish one figure
    // for things that are retained differently.
    basis:
      "Set at the provider that receives the events. Nothing is sent unless you accept analytics or error tracking, and nothing we run deletes or expires an event, a replay, or a report.",
  },
  {
    // The one processor on this page that IS collecting something today, and
    // for five rounds the only one with no period next to it. The reason it
    // had none was sound as far as it went — nothing in this repository sets
    // or applies the figure, so a number typed here would have been invented
    // — but a retention table that presents itself as an inventory and omits
    // the live collector is a worse failure than a provider-set period stated
    // as a provider-set period. Section 7 states it now, and both numbers are
    // quoted from Vercel's published documentation rather than measured here:
    // the 24-hour discard of the visitor hash is on Vercel's Web Analytics
    // privacy and compliance page, and the reporting window (1 month on
    // Hobby, 12 on Pro, 24 with the Plus add-on or Enterprise) is on its
    // pricing page. That page also defines the window as the period the data
    // is GUARANTEED to stay available, not a deletion deadline, so the basis
    // says so — publishing it as a ceiling would repeat the mistake the
    // Backups row was corrected for.
    item: "Vercel Web Analytics",
    period: "24 hours · 1 to 24 months",
    basis:
      "Set by Vercel, not by us. Its documentation states the visitor identifier is discarded after 24 hours and that the reporting window runs 1 to 24 months by plan, and that the window is a guarantee of availability rather than a deletion deadline. The beacon runs on the showflow.pro website only, after consent.",
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
 *  on write", which turned naming two exceptions into a claim that the
 *  other 26 carry a database policy. They do not: six are checked only by an
 *  edge function (invite_artists, run_offer_engine, resend_account_invite,
 *  generate_hire_orders, issue_hire_orders, trigger_sync), which is
 *  server-side but not "in the database", and this sentence's own wording
 *  makes that difference load-bearing. So the split is stated in full here
 *  and the lead-in is gone from both surfaces.
 *
 *  The three-way split — 20 in the database, 6 edge-only, 3 interface-only —
 *  is recomputed from the registry, the migrations and the edge tree by
 *  capabilityEnforcement.test.ts, which fails if any of the three numbers or
 *  the named interface-only set moves. facts.ts cannot import
 *  capabilities.ts (the trust.json loader rejects any import here), so a test
 *  is the only place the count can be pinned.
 *
 *  "In the database" covers two shapes, and the sentence names both because
 *  19 of the 20 are the first and one is the second: an is_capability_enabled
 *  call in the row-level policy that guards the write, or the same call
 *  inside the SECURITY DEFINER function that performs it — rename_org, which
 *  bypasses RLS by design, is gated in its own body
 *  (20260723191933_rpc_capability_gates.sql). Calling all 20 "a database
 *  policy" would have repeated the finding's mistake one level down. */
export const CAPABILITY_INTERFACE_ONLY_NOTE =
  "26 of the 29 rights are checked on the server: 20 inside the database, by the row-level policy that guards the write or by the function that performs it, and 6 more by an edge function that asks the same database check before it acts. The remaining three reorder or archive the production catalog, or manage the skills catalog; only the interface enforces those.";

export interface Control {
  icon: string;
  title: string;
  /** The control, in plain words.
   *
   *  HELD TO 45 WORDS, and pinned there by factsDensity.test.ts.
   *
   *  This is the field the public page's Summary/Full control does NOT gate,
   *  so it is what a reviewer reads first and it is the only thing setting the
   *  height of a card in a three-across grid. Left unpinned it ran 29 to 126
   *  words across six siblings, which did two measurable kinds of damage:
   *  "Roles and rights" was fifteen lines of body copy in the view a reviewer
   *  picked because they wanted less, and the 97-word spread inside a row left
   *  223px of empty card beside it. A ceiling alone would not fix the second
   *  problem — the void is set by the SPREAD — so the test pins a floor too.
   *
   *  Shortening never means dropping a qualifier. Anything that stops a
   *  sentence over-claiming stays in `claim`; detail that merely enriches it
   *  moves to `evidence`. */
  claim: string;
  /** Where a reviewer can go to check it. Full-inventory only on the public
   *  page, so nothing load-bearing may live here alone. Held to 50 words for
   *  the same rhythm reason `claim` is. */
  evidence: string;
}

export const CONTROLS: Control[] = [
  {
    icon: "lock",
    title: "Tenant isolation",
    // "One restrictive database policy per table" said more than the cited
    // test does: org_coverage.sql names four org_id-carrying tables it
    // excludes on purpose. The claim keeps the concession — a Summary reader
    // must not meet the unqualified "every table" — but naming the four and
    // giving each one's reason is detail, and it moves to `evidence`. It is
    // published in full either way: CROSS_ORG_EXCEPTIONS_NOTE renders under
    // the access matrix in both modes on both surfaces.
    claim:
      "Every table holding your data carries its organisation, and a restrictive database policy on each one means a session reads only organisations it belongs to. Four named tables sit outside it, and refuse the cross-organisation read another way.",
    // "on shows and show_dates" is NOT trimmable, and was trimmed once by a
    // density pass that should not have touched it. org_isolation.sql exercises
    // exactly two tenant tables (public.shows fifteen times, public.show_dates
    // twice; its three other public.* references are fixture setup) out of the
    // 38 that carry org_id. Without the scope the sentence reads as a
    // table-agnostic cross-org result, which is the failure mode the header of
    // CROSS_ORG_EXCEPTIONS_NOTE describes: a reviewer greps the cited file,
    // finds less than the citation promised, and stops trusting the page. The
    // breadth comes from the NEXT sentence and a different artefact —
    // org_coverage.sql, which is the one that walks every table — so narrowing
    // this one costs the card nothing.
    //
    // 38, not the 34 an earlier round wrote, and this is the denominator the
    // shipped four-exception footnote rests on: org_coverage.sql's
    // _tenant_tables list is 34 names it ASSERTS org_isolation on, and its
    // header names 4 more that carry org_id and are excluded on purpose
    // (org_memberships, org_invitations, platform_audit_log, email_send_log).
    // 34 is the size of the assertion, not of the population.
    evidence:
      "supabase/tests/rls/org_isolation.sql asserts org A reads and writes zero rows of org B on shows and show_dates, even holding a global producer role. org_coverage.sql lists every table carrying the policy, including chat_messages and booking_audit_log, and names the four exceptions. Both run on every pull request; restrictive policies filter, never grant.",
  },
  {
    icon: "users",
    title: "Roles and rights",
    // Two things have to survive in `claim` rather than move to `evidence`,
    // because `evidence` is Full-inventory only and Summary is what a reviewer
    // lands on:
    //
    //  - the interface-only carve-out. Without it Summary reads as though all
    //    29 rights are enforced server-side. The full sentence is
    //    CAPABILITY_INTERFACE_ONLY_NOTE, which used to be interpolated here
    //    whole (58 words on its own) and still renders verbatim on the
    //    capabilities card; the claim now carries its load-bearing half, the
    //    26/3 split, and leaves the 20-in-database / 6-edge breakdown and the
    //    names of the three to `evidence` and to that card.
    //  - the disambiguation of the two nines. Left in `evidence` it produced
    //    exactly the conflation this build exists to kill: two nines side by
    //    side reading as one set. "a different nine" does that inline in two
    //    words; `evidence` carries the example that proves it.
    //
    // "and ask for a second confirmation" described the wrong action, next to
    // the word "sensitive", which is where a reviewer reads step-up
    // confirmation AT USE TIME. There is no such step: the confirmation guards
    // an ADMINISTRATOR changing the grant in Settings > Roles and permissions
    // (PermissionsMatrix.tsx:46-49 routes a sensitive key to `setPending`, the
    // AlertDialog at :81-101 is the dialog), and a producer exercising a right
    // it has been granted meets nothing extra. capabilityEnforcement.test.ts
    // pins the sentence to that file.
    claim:
      "Three roles per organisation and 29 rights on top. 26 are checked on the server, three only by the interface. Nine rights are marked sensitive, so changing one asks an administrator to confirm; a different nine ship switched off until an administrator turns them on.",
    // "which is why the two nines differ" gave half the reason and a reviewer
    // doing the arithmetic landed on 7: the hire-order pair is sensitive-yet-on,
    // which takes 9 sensitive down to 7 also-off, and the sets only meet at
    // nine again because edit_filter_settings and trigger_sync are standard yet
    // ship off. Both directions are named now, and capabilityInventory.test.ts
    // re-derives both counts from the registry.
    evidence:
      "29 rights across 8 groups, declared in src/lib/capabilities.ts. Of the 26 checked on the server, 20 sit inside the database and 6 in an edge function. Issuing and voiding hire orders are sensitive yet ship on, and two standard rights ship off, so the two nines are different sets.",
  },
  {
    icon: "key",
    title: "Encryption and secrets",
    claim:
      "TLS in transit, encryption at rest in managed Postgres. Integration keys live in a secrets vault and are readable only by server functions, never by members of your organisation.",
    // "readable only by server functions, never by members of your
    // organisation" is a grant, and the grant is what a reviewer should be
    // pointed at: 20260604131000_org_airtable_vault.sql:35-40 revokes EXECUTE
    // on the reader from `public` and `authenticated` and grants it to
    // `service_role` alone, so the claim is not a policy that could be
    // reasoned around but a permission that is simply absent.
    evidence:
      "The Airtable key is written to Supabase Vault by the admin-guarded set_org_airtable_key and never read back to a client: EXECUTE on the reader, get_org_airtable_key, is revoked from authenticated and granted to the service role only.",
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
    // "who acted" is frequently absent rather than always present. Both of
    // those are limitations on the claim, so both stay in `claim`.
    //
    // What left is the sentence naming who can read the log, because the
    // access matrix answers that for all three roles two sections down, and
    // the worked example of the limitation ("editing its notes leaves no
    // row"), which belongs beside the trigger that causes it.
    title: "Auditability",
    // "No policy permits an update or a delete" was literally true and read as
    // immutability, which is the exact true-but-misleading shape this page
    // rewrote "checked in the database" into a 20/6/3 split to avoid.
    //
    // The first replacement traded that for "Only account or organisation
    // deletion ever changes a row", which was FALSE, and false in the more
    // dangerous direction: an exhaustive claim rather than a vague one. It
    // came from an exhaustiveness check that was correct inside its own scope
    // and wrong about the scope — every function body in the tree was scanned
    // for an UPDATE or DELETE against the table, and referential integrity
    // writes neither. Deleting a show date cascades to its bookings and RI
    // then NULLs `booking_id` on every audit row they own; see the matrix row
    // above for the full chain and for why the UI enables that delete.
    //
    // So: three paths, all three named, no "only" left to be wrong about. The
    // policy fact is not dropped — it moves to `evidence` beside the three
    // things that get past it, which is where a reviewer can act on it.
    claim:
      "Every change to a booking's status is appended to a log: old status, new status, who acted, when. Nothing else about a booking is logged; automated transitions have no person to record as the actor. Account, show-date and organisation deletions clear fields or remove rows.",
    evidence: `Written by notify_booking_transition, which returns without writing unless the status changed, so editing its notes leaves no row; promote_understudy_on_cancellation writes the automated path. No policy grants an update or a delete; account anonymisation, organisation deletion and booking_id's ON DELETE SET NULL get past it. Retained ${RETENTION.find((r) => r.item === "Bookings and audit log")!.period}.`,
  },
  {
    icon: "shield",
    title: "Application security",
    // "run as security-definer database functions" named a Postgres feature by
    // its keyword, which is the shape of specificity this page was told to
    // stop spending: a reader who does not already know what a security
    // definer is learns nothing, and a reader who does was going to open the
    // evidence line anyway. The guarantee is that the checks are in ONE place
    // and therefore auditable, and that is what the sentence says now. The
    // five functions are still named, in `evidence`.
    claim:
      "Role checks are centralised in a handful of database functions rather than scattered through the queries that use them, so there is one place to audit. Every pull request is scanned for committed secrets, and dependency updates arrive as grouped weekly pull requests.",
    evidence:
      "Checks concentrated in has_org_role, is_org_member, is_capability_enabled, is_feature_enabled, and capability_default: one place to audit. scripts/scan-secrets.mjs runs in the same lint job, and .github/dependabot.yml opens the weekly grouped updates.",
  },
  {
    icon: "database",
    title: "Backups",
    claim: `Managed Postgres, hosted by Supabase. ${BACKUP_CEILING_NOTE}`,
    evidence:
      "Stated in section 7 of the privacy policy. Nothing in this repository writes or expires a backup: the window is set by the managed database provider.",
  },
];

export const TRANSFER_BASIS_NOTE =
  "Adequacy decision of 10 July 2023 (EU-US Data Privacy Framework) or the Standard Contractual Clauses of 4 June 2021, with encryption in transit and at rest.";

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
    // The two surfaces have two separate consent stores and two separate
    // controls, and only one of them has anything to switch off, so this names
    // both rather than averaging them into something true of neither.
    //
    // The app half went through two wrong drafts. It first read "Turns off
    // analytics, session replay, and error tracking if and when any of them is
    // enabled", which told a reader of this page that no analytics was running
    // while a page-view beacon was running on the page they were reading it
    // on. Naming the surfaces separately fixed that half and left three
    // defects in the app clause: the "Manage cookie preferences" control is on
    // the PUBLIC privacy page (PrivacyPage.tsx:51-55) and the login page, not
    // inside the signed-in app; nothing anywhere reads `useConsent().consent`
    // to load or unload a tracker, so it turns nothing off; and "if and when
    // any of them is enabled" is the forward-looking framing this page does
    // not do — its sibling ("12 months, once PostHog is enabled") was cut from
    // the retention column for exactly that reason.
    //
    // The app clause then said "records a separate choice ... and loads none
    // of the three", which was the honest reading while the subprocessor table
    // carried PostHog at "Off". It is not the reading any more: the table
    // discloses PostHog as a processor that receives data after consent (and
    // AnalyticsBridge now reads useConsent() to load and unload it), so a right
    // that told the same reader nothing is loaded would contradict the section
    // above it. What the clause states now is the right itself — three separate
    // choices, changeable at any time — which is what Art. 7(3) is about.
    title: "Withdraw analytics consent",
    detail:
      "On showflow.pro, Cookie settings in the footer stops the page-view analytics that loads only after you accept. In the app, analytics, session replay, and error tracking each take their own choice, and Manage cookie preferences changes any of them at any time. Art. 7(3).",
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
    // with different dates, and a reviewer establishing which statements are
    // authoritative should not have to guess.
    //
    // The scope note used to read "covers the app, not the showflow.pro
    // website", which was true of section 2 as it then stood and is false of
    // it now: section 2 lists the public website alongside the application,
    // the emails and the in-app surfaces, because section 5 discloses two
    // processors (web fonts, Vercel Web Analytics) that operate there. It
    // still is not the *only* document covering that site — the marketing
    // site publishes its own notice — so the note says which of the two this
    // is rather than claiming exclusivity.
    //
    // The date is printed in the document's own format ("11 August 2026") so
    // the assertion against it is a string containment rather than a
    // reformatting step that could quietly stop matching. It was a hand-typed
    // literal nobody checked; facts.privacy.test.ts now parses the policy's
    // `_Last updated:_` line and fails if the two disagree, and pins the
    // German twin's `_Stand:_` to the same day.
    meta: "Web · the product policy, covering the app and the showflow.pro website · updated 11 August 2026",
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
export const FACTS_LAST_REVIEWED = "2026-09-14";
