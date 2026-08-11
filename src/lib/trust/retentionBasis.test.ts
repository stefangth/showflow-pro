// RETENTION publishes eight periods. facts.privacy.test.ts already proves each
// one matches section 7 of the privacy policy — but matching the policy is not
// the same as being true of the deployment, and for most of these rows nothing
// in the repo applies the period at all. Printed bare, a period reads as a
// schedule; five of the eight have no schedule behind them and one (the email
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
describe("the rows that claim enforcement point at code that enforces it", () => {
  it("pins the chat archive window to CHAT_ARCHIVE_DAYS", () => {
    const { basis } = row("Show-date chat");
    expect(basis).toContain("CHAT_ARCHIVE_DAYS");
    const days = basis.match(/(\d+)\s*day/)?.[1];
    expect(days, "the chat basis stopped stating the archive window").toBeDefined();
    expect(Number(days)).toBe(CHAT_ARCHIVE_DAYS);
  });

  it("pins the email prune to prune_email_log and its seeded retention setting", () => {
    const { basis } = row("Email send log and suppressions");
    expect(basis).toContain("prune_email_log");
    expect(basis).toContain("email_log_retention_days");

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
    const { basis } = row("Account and profile");
    expect(basis).toContain("delete-my-account");
    const fn = readFileSync(resolve(ROOT, "supabase/functions/delete-my-account/index.ts"), "utf8");
    expect(fn).toContain("anonymize_user");
    expect(fn).toContain("deleteUser");
  });

  it("pins the two rows that cite delete_org to a function that deletes those tables", () => {
    expect(row("Bookings and audit log").basis).toContain("delete_org");
    for (const table of ["bookings", "booking_audit_log", "chat_messages"]) {
      expect(SQL).toContain(`delete from public.${table} where org_id = p_org`);
    }
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

  it("ships no error-tracking or product-analytics package, which is why those two rows are conditional", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(installed.filter((p) => /sentry/i.test(p))).toEqual([]);
    expect(installed.filter((p) => /posthog/i.test(p))).toEqual([]);

    // No error tracking runs anywhere on either surface, so the unqualified
    // form is true for this row.
    expect(row("Error reports").basis).toMatch(/nothing is collected/i);
  });

  // The analytics row cannot borrow the error row's wording. Analytics IS
  // running on the public trust page: SUBPROCESSORS discloses Vercel Web
  // Analytics at status "Consent", and the landing repo mounts it on this very
  // route once a reader accepts. A blanket "so nothing is collected" would be
  // falsified by scrolling two sections up on the same page. The row is about
  // PostHog's product analytics and session replay, and that is the pair the
  // sentence must deny.
  it("denies product analytics and session replay specifically, not analytics as a whole", () => {
    const inUse = SUBPROCESSORS.filter((s) => /analytics/i.test(s.purpose) && s.status !== "Off");
    expect(
      inUse.length,
      "no analytics processor is in use any more — this row may drop the qualifier",
    ).toBeGreaterThan(0);

    const { basis } = row("Analytics and session replay");
    expect(basis).toMatch(/no product analytics or session replay is collected/i);
    expect(basis, "a blanket denial contradicts the subprocessor table two sections up").not.toMatch(
      /so nothing is collected/i,
    );
  });

  it("keeps the two provider-set rows attributed to the provider, not to this codebase", () => {
    for (const item of ["Backups", "Hosting and database logs"]) {
      expect(row(item).basis).toMatch(/provider/i);
      expect(row(item).basis).toMatch(/[Nn]othing in this codebase/);
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
