// RETENTION publishes nine periods. facts.privacy.test.ts already proves each
// one matches section 7 of the privacy policy — but matching the policy is not
// the same as being true of the deployment, and for most of these rows nothing
// in the repo applies the period at all. Printed bare, a period reads as a
// schedule; six of the nine have no schedule behind them and one (the email
// row) had a configured prune pointing at a shorter window than the number on
// the page.
//
// The rows were not deleted: the commitment is real, and section 7 is the
// artefact behind it. What changed is that each row now says what applies it,
// and this suite is what keeps those sentences honest. It re-derives the
// mechanism half from the migrations, the edge tree and the dependency
// manifest, so the day a prune job or an analytics SDK lands, the concession
// this table publishes goes red instead of quietly becoming false.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_ARCHIVE_DAYS } from "@/config/app.config";
import { RETENTION, RETENTION_BASIS_NOTE, SUBPROCESSORS } from "./facts";

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .join("\n");

function row(item: string) {
  const found = RETENTION.find((r) => r.item === item);
  expect(found, `the "${item}" retention row was renamed or removed`).toBeDefined();
  return found!;
}

describe("every retention row says what applies its period", () => {
  it.each(RETENTION)("$item carries a basis", ({ item, basis }) => {
    expect(basis, `${item} has no basis`).toBeTruthy();
    expect(basis.trim().length, `${item}'s basis is too short to say anything`).toBeGreaterThan(20);
  });

  it("introduces the basis line on the surfaces that render it", () => {
    expect(RETENTION_BASIS_NOTE).toMatch(/provider/);
    expect(RETENTION_BASIS_NOTE).toMatch(/commitment/);
  });
});

// The two rows that name a mechanism must name one that exists, and quote the
// number it actually uses.
//
// THE IDENTIFIERS MOVED OUT OF THE PUBLISHED SENTENCES, NOT OUT OF THIS FILE.
// These bases used to close with the constant, function and setting names that
// implement them ("CHAT_ARCHIVE_DAYS in src/config/app.config.ts",
// "prune_email_log, email_log_retention_days", "the delete-my-account
// function", "(delete_org)"), and the assertions below were string
// containments against those names. A trust page owes a reader the guarantee,
// not the identifier, so the names are gone from the copy — but the pin is the
// point of this file, so every one of them is now asserted against the code
// directly and the published FIGURE is what is compared. That is a stronger
// gate than a containment: a sentence could always name prune_email_log while
// quoting the wrong number.
describe("the rows that claim enforcement point at code that enforces it", () => {
  it("pins the chat archive window to CHAT_ARCHIVE_DAYS", () => {
    const { basis } = row("Show-date chat");
    // The product applies this one, and says so.
    expect(basis).toMatch(/applied by the product/i);
    const days = basis.match(/(\d+)\s*day/)?.[1];
    expect(days, "the chat basis stopped stating the archive window").toBeDefined();
    expect(Number(days)).toBe(CHAT_ARCHIVE_DAYS);
  });

  it("pins the email prune to prune_email_log and its seeded retention setting", () => {
    const { basis } = row("Email send log and suppressions");

    // The function exists, deletes the table the basis says it deletes, and is
    // on a schedule.
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.prune_email_log/i);
    expect(SQL).toMatch(/DELETE FROM public\.email_send_log/i);

    // GUARD HOLE, closed: asserting only that a job by this NAME exists let
    // "pruned nightly" survive the schedule being changed to weekly or
    // monthly. The expression is what the word "nightly" is a claim about, so
    // the expression is what gets asserted — a five-field cron whose
    // day-of-month, month and day-of-week are all wildcards runs every day.
    const expression = SQL.match(/cron\.schedule\(\s*'email-log-prune'\s*,\s*'([^']+)'/)?.[1];
    expect(expression, "no cron job named email-log-prune is scheduled").toBeDefined();
    const [, , dayOfMonth, month, dayOfWeek] = expression!.trim().split(/\s+/);
    expect(
      [dayOfMonth, month, dayOfWeek],
      `email-log-prune runs on "${expression}", which is not nightly`,
    ).toEqual(["*", "*", "*"]);
    expect(basis).toMatch(/nightly/i);

    // ...at the number the page prints. Both the seeded app_settings value and
    // the function's own COALESCE fallback are that number, so neither can
    // drift from the published figure without this failing.
    const quoted = basis.match(/(\d+)\s*days by default/)?.[1];
    expect(quoted, "the email basis stopped stating the configured window").toBeDefined();
    expect(SQL).toContain(`'email_log_retention_days', '${quoted}'::jsonb`);
    expect(SQL).toMatch(
      new RegExp(`WHERE org_id IS NULL AND key = 'email_log_retention_days'\\),\\s*${quoted}\\)`),
    );
  });

  it("pins the account-deletion path to the function that runs it", () => {
    // The basis promises two steps in one order: anonymise what booking
    // records must keep, THEN remove the login. That order is the claim.
    const { basis } = row("Account and profile");
    expect(basis).toMatch(/anonymises what booking records must keep, then removes the login/i);

    const fn = readFileSync(resolve(ROOT, "supabase/functions/delete-my-account/index.ts"), "utf8");
    expect(fn).toContain("anonymize_user");
    expect(fn).toContain("deleteUser");
    expect(
      fn.indexOf("anonymize_user"),
      "the function removes the login before anonymising — the published order is wrong",
    ).toBeLessThan(fn.indexOf("deleteUser"));
  });

  it("pins the bookings row to a function that deletes those tables with the organisation", () => {
    // "they go when the organisation itself is deleted" is the claim; the
    // function that makes it true used to be named in the sentence and is
    // asserted here instead.
    expect(row("Bookings and audit log").basis).toMatch(
      /they go when the organisation itself is deleted/i,
    );
    for (const table of ["bookings", "booking_audit_log", "chat_messages"]) {
      expect(SQL).toContain(`delete from public.${table} where org_id = p_org`);
    }
  });
});

// ── The register the public page is held to ───────────────────────────────
//
// A retention basis renders on the public trust page in both detail modes, so
// it is one of the strings a prospective customer reads first. Naming the
// constant, the function or the file that applies a period tells that reader
// nothing they can act on and reads as a page written for its own authors.
// Every one of those names is still asserted, above, against the code itself.
describe("no retention basis names the code that applies it", () => {
  /** The identifiers that used to ride in these sentences, plus the shapes
   *  that would bring them back: a path, a snake_case function or setting, a
   *  SCREAMING_SNAKE constant, or a kebab-case edge-function folder. */
  const IDENTIFIER = /\b[a-z0-9]+(?:\/[a-z0-9._-]+)+\b|\b[a-z]+(?:_[a-z0-9]+)+\b|\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|\bdelete-my-account\b/;

  it.each(RETENTION)("$item states its basis without an identifier", ({ basis }) => {
    const hit = basis.match(IDENTIFIER);
    expect(hit?.[0], `"${basis}" names ${hit?.[0]}`).toBeUndefined();
  });
});

// The other half of the promise: the rows that concede "no scheduled job" must
// keep being true. A prune landing later without this table being revisited is
// exactly the drift this file exists to catch — in the direction that makes the
// page understate rather than overstate, which is still a stale claim.
describe("the rows that concede no schedule are still conceding accurately", () => {
  /** Every `cron.schedule('name', 'expr', $$body$$)` in the migration tree. */
  function cronJobs(): { name: string; body: string }[] {
    const jobs = [
      ...SQL.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*\$\$([\s\S]*?)\$\$/g),
    ].map((m) => ({ name: m[1], body: m[2] }));
    expect(jobs.length, "no cron jobs found — the scan pattern has drifted").toBeGreaterThan(0);
    return jobs;
  }

  it("schedules nothing that prunes bookings, the audit log, chat or the suppression list", () => {
    const touching = cronJobs()
      .filter(({ body }) =>
        /\b(bookings|booking_audit_log|chat_messages|suppressed_emails)\b/.test(body),
      )
      .map(({ name }) => name);
    expect([...new Set(touching)]).toEqual([]);
  });

  it("deletes suppressed_emails nowhere, which is why 24 months is a commitment for it", () => {
    const { basis } = row("Email send log and suppressions");
    expect(basis).toMatch(/suppression list has no scheduled prune/i);
    expect(SQL).not.toMatch(/DELETE FROM public\.suppressed_emails/i);
  });

  // These two rows used to READ as denials — "no error-tracking package ships
  // in the application, so nothing is collected", "no PostHog package ships …
  // so no product analytics or session replay is collected" — on the strength
  // of the package-absence check below. Both processors are in use now
  // (SUBPROCESSORS carries them at "Consent"), so the denials are gone and the
  // periods are stated flat.
  //
  // The package check is NOT gone, and it has changed job rather than lost
  // one. Nothing in this repository shows how the data reaches either
  // processor, so the constraint these rows are held to is that they must not
  // pretend otherwise: state the processing and the gate, never a mechanism.
  // publishedClaims.test.ts enforces the no-mechanism half across the whole
  // contract; this pins the premise it rests on.
  it("still ships no error-tracking or product-analytics package, which is why no basis names one", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(installed.filter((p) => /sentry/i.test(p))).toEqual([]);
    expect(installed.filter((p) => /posthog/i.test(p))).toEqual([]);
  });

  it("states both consent-gated periods flat, with the gate and no mechanism", () => {
    for (const item of ["Error reports", "Analytics and session replay"]) {
      const { period, basis } = row(item);
      // A bare figure, no condition riding in the value column.
      expect(period).toMatch(/^\d+\s+(?:days|months)$/);
      // Attributed to the provider that holds it, which is what makes it a
      // period rather than a promise we cannot keep.
      expect(basis).toMatch(/set at the provider/i);
      // The gate, stated. Dropping it would publish these as unconditional
      // collection, which contradicts the "Consent" status two sections up.
      expect(basis).toMatch(/nothing is sent unless you accept/i);
      // And no residue of the denial these rows used to carry.
      expect(basis, `${item} still denies the collection it now discloses`).not.toMatch(
        /nothing is collected|is collected\b(?!.)/i,
      );
    }
  });

  // The analytics row still cannot borrow a blanket word. Two different
  // analytics processors are disclosed with two different periods: PostHog's
  // product analytics and session replay here, and the public website's
  // page-view beacon in its own row. One figure for both would be wrong for
  // one of them.
  it("keeps the analytics row scoped to product analytics and session replay", () => {
    const analytics = SUBPROCESSORS.filter((s) => /analytics/i.test(s.purpose));
    expect(
      analytics.length,
      "the two analytics processors collapsed into one — re-read this row's scope",
    ).toBeGreaterThan(1);

    const { basis } = row("Analytics and session replay");
    expect(basis).toMatch(/event/i);
    expect(basis).toMatch(/replay/i);

    // …and the page-view beacon keeps its own row and its own numbers.
    const beacon = row("Vercel Web Analytics");
    expect(beacon.period).not.toBe(row("Analytics and session replay").period);
  });

  it("keeps the two provider-set rows attributed to the provider, not to us", () => {
    for (const item of ["Backups", "Hosting and database logs"]) {
      expect(row(item).basis).toMatch(/provider/i);
      expect(row(item).basis).toMatch(/[Nn]othing we run/);
    }
  });

  // The logs row is titled "Hosting and database logs" and its basis denies
  // that anything here expires them. Section 7 means the PROVIDERS' logs by
  // that phrase, but this repo does prune two operational tables whose names
  // end in _log (cron-health-watcher deletes cron_health_dispatch after a day
  // and cron_health_log after thirty), and a reviewer grepping for a prune
  // finds them. The row is not about those, so the sentence says whose logs it
  // means; this is what keeps the scope on it.
  it("scopes the hosting-log denial to the providers' own logs", () => {
    const { basis } = row("Hosting and database logs");
    expect(basis).toMatch(/providers' own logs/i);

    // The premise for why the scope is needed: this codebase really does prune
    // something with "log" in its name. If that ever stops being true the
    // qualifier is merely redundant rather than wrong, so this only documents
    // it rather than asserting the count.
    const watcher = readFileSync(
      resolve(ROOT, "supabase/functions/cron-health-watcher/index.ts"),
      "utf8",
    );
    expect(watcher).toMatch(/from\("cron_health_log"\)\s*\.delete\(\)/);
  });
});
