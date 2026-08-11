// Pins the Auditability control to the trigger that actually writes the log.
//
// The claim used to read "Booking changes are appended to a log: who acted,
// what changed, the timestamp." Three parts of that were wider than the code:
// only a STATUS change is written (the trigger returns before the insert on an
// INSERT, and on an UPDATE that leaves status alone), "what changed" is only
// old_status -> new_status, and `performed_by` is `auth.uid()`, which is NULL
// for every server-side write — the automated understudy promotion passes NULL
// explicitly. The claim now says all three, and this fails if any of them
// stops being true.
//
// Reading the migrations rather than a live database is the same trade
// facts.privacy.test.ts makes with the policy documents: no stack to boot, and
// the assertion still breaks the moment someone widens or narrows the trigger.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROLS, VISIBILITY_MATRIX } from "./facts";

const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");

const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort() // filename order is the timestamped apply order
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));

/** The body of the LAST `create or replace function public.<name>` in
 *  migration order — the definition production actually runs. Every one of
 *  these functions has been replaced several times, so an unfiltered grep
 *  would happily assert against a superseded body. */
function latestFunctionBody(name: string): string {
  const pattern = new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i");
  const owner = [...FILES].reverse().find((f) => pattern.test(f.sql));
  expect(owner, `no migration defines public.${name}`).toBeDefined();

  const chunks = owner!.sql.split(pattern);
  const body = chunks[chunks.length - 1];
  // Stop at the function's own terminator so a later function in the same file
  // cannot leak into the assertions.
  const end = body.indexOf("$$;");
  return end === -1 ? body : body.slice(0, end);
}

/** The single `INSERT INTO public.booking_audit_log …;` statement inside a
 *  function body, so an assertion about its values cannot accidentally read
 *  the rest of the function. */
function auditInsert(body: string): string {
  const start = body.indexOf("INSERT INTO public.booking_audit_log");
  expect(start, "the function no longer writes an audit row").toBeGreaterThan(-1);
  const statement = body.slice(start);
  const end = statement.indexOf(");");
  return end === -1 ? statement : statement.slice(0, end + 2);
}

describe("booking audit log — what the trigger actually records", () => {
  const notify = latestFunctionBody("notify_booking_transition");
  const promote = latestFunctionBody("promote_understudy_on_cancellation");

  it("writes nothing unless a booking's status changed", () => {
    const guard = notify.indexOf("IF TG_OP != 'UPDATE' OR OLD.status = NEW.status THEN");
    const insert = notify.indexOf("INSERT INTO public.booking_audit_log");
    expect(guard, "the status-changed guard is gone from notify_booking_transition").toBeGreaterThan(-1);
    expect(insert, "notify_booking_transition no longer writes the audit row").toBeGreaterThan(-1);
    // The guard has to run BEFORE the insert, or an INSERT and a no-op UPDATE
    // would both be logged and the claim would be understating the log.
    expect(guard).toBeLessThan(insert);
  });

  it("records only the status pair, the actor and the time", () => {
    const columns = notify.match(/INSERT INTO public\.booking_audit_log \(([^)]*)\)/)?.[1] ?? "";
    expect(columns.split(",").map((c) => c.trim())).toEqual([
      "booking_id",
      "action",
      "old_status",
      "new_status",
      "performed_by",
    ]);
    // `created_at` is the timestamp and defaults to now(); `details` exists on
    // the table but no writer fills it, which is why the claim promises no
    // free-text record of what else changed.
    expect(notify).toContain("auth.uid()");
  });

  it("records an automated promotion with no actor", () => {
    const statement = auditInsert(promote);
    expect(statement).toContain("'understudy_promoted'");
    // NULL, not auth.uid(): the promotion runs inside a trigger under the
    // service role, so there is no person to name.
    expect(statement).toContain("NULL");
    expect(statement).not.toContain("auth.uid()");
  });

  // GUARD HOLE, closed: the old form of this required an explicit
  // `FOR update|delete`, and a policy with no FOR clause defaults to ALL. So
  // `create policy "…" on public.booking_audit_log to authenticated using
  // (true)` — a policy that grants every command including update and delete —
  // matched nothing and passed, while falsifying the published claim. Every
  // policy on the table is enumerated instead, and any command other than
  // SELECT or INSERT fails, whether it was named or defaulted into.
  it("never grants an update or a delete on the log, including by defaulting to ALL", () => {
    const granted: { file: string; policy: string; command: string }[] = [];
    for (const { name, sql } of FILES) {
      for (const match of sql.matchAll(
        /create\s+policy\s+("(?:[^"]+)"|[a-z_]+)\s+on\s+public\.booking_audit_log\b([\s\S]{0,120}?)(?:\bto\b|\busing\b|\bwith\s+check\b|;)/gi,
      )) {
        const preamble = match[2];
        // `as restrictive` narrows, it never grants, so it cannot widen the
        // claim; anything else with no FOR clause is a PostgreSQL `FOR ALL`.
        if (/\bas\s+restrictive\b/i.test(preamble)) continue;
        const command = preamble.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1] ?? "all (defaulted)";
        granted.push({ file: name, policy: match[1], command: command.toLowerCase() });
      }
    }
    expect(granted.length, "no policy on booking_audit_log found — the scan pattern has drifted").toBeGreaterThan(0);
    expect(
      granted.filter((g) => g.command !== "select" && g.command !== "insert"),
      "a policy grants more than select/insert on booking_audit_log",
    ).toEqual([]);
  });

  // The other half of the append-only claim, and the reason it is no longer
  // phrased as "no policy permits an update or a delete".
  //
  // GUARD HOLE, closed — and closed a second time, which is the point. The
  // first version of this scanned `create or replace function` bodies for an
  // UPDATE or a DELETE against the table, found exactly anonymize_user and
  // delete_org, and licensed an exhaustive "Only account or organisation
  // deletion ever changes a row". That sentence was FALSE. A third path exists
  // and writes no SQL at all: `booking_audit_log.booking_id` is `REFERENCES
  // public.bookings(id) ON DELETE SET NULL`, and referential integrity's SET
  // NULL is an UPDATE. It matched no pattern the scan knew, which is the same
  // shape as the FOR-clause hole above — a scan that knows one syntactic form
  // while the exception arrives in another.
  //
  // So both shapes are derived: what functions write, and what the table's own
  // foreign keys make the database write. A new FK with SET NULL, SET DEFAULT
  // or CASCADE turns this red on its own, without anyone having to remember
  // that RI mutates.
  describe("every path that can change a row after it is written", () => {
    /** Functions whose body issues an UPDATE or DELETE against the log. */
    function functionMutators(): string[] {
      const found = new Set<string>();
      for (const { sql } of FILES) {
        for (const match of sql.matchAll(
          /create or replace function public\.([a-z_]+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/gi,
        )) {
          if (/\b(update|delete\s+from)\s+public\.booking_audit_log\b/i.test(match[2])) {
            found.add(match[1]);
          }
        }
      }
      return [...found].sort();
    }

    /** The CREATE TABLE body for a table, from the migration that creates it. */
    function createTableBody(table: string): string {
      const pattern = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table}\\s*\\(`, "i");
      const owner = FILES.find((f) => pattern.test(f.sql));
      expect(owner, `no migration creates public.${table}`).toBeDefined();
      const after = owner!.sql.split(pattern)[1];
      const end = after.indexOf("\n);");
      return end === -1 ? after : after.slice(0, end);
    }

    /** Every column-level FK on a table, with the action RI takes on parent
     *  delete. A column with no ON DELETE clause is NO ACTION: RI refuses the
     *  parent delete rather than touching the child, so it cannot change a
     *  row and is reported as such. */
    function foreignKeys(table: string): { column: string; parent: string; onDelete: string }[] {
      const body = createTableBody(table);
      // Later migrations add columns by ALTER; fold those in so an FK added
      // after the table was created cannot hide from this.
      const altered = FILES.map((f) => f.sql)
        .join("\n")
        .match(new RegExp(`alter table public\\.${table}[^;]*references[^;]*;`, "gi"))
        ?.join("\n") ?? "";
      const out: { column: string; parent: string; onDelete: string }[] = [];
      for (const match of `${body}\n${altered}`.matchAll(
        /\b([a-z_]+)\s+uuid\b[^,;]*?references\s+(?:public|auth)\.([a-z_]+)\s*\([^)]*\)([^,;]*)/gi,
      )) {
        const onDelete = match[3].match(/on\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i);
        out.push({
          column: match[1].toLowerCase(),
          parent: match[2].toLowerCase(),
          onDelete: (onDelete?.[1] ?? "no action").toLowerCase().replace(/\s+/g, " "),
        });
      }
      return out.sort((a, b) => a.column.localeCompare(b.column));
    }

    /** The FKs whose action makes the DATABASE write to the child row. */
    const RI_MUTATING = /^(cascade|set null|set default)$/;

    it("finds exactly the two functions that write an update or a delete", () => {
      expect(functionMutators()).toEqual(["anonymize_user", "delete_org"]);
    });

    it("finds exactly one foreign key whose parent delete rewrites a row", () => {
      const keys = foreignKeys("booking_audit_log");
      expect(keys.length, "no FKs parsed — the scan pattern has drifted").toBeGreaterThan(0);
      // The published sentence names three paths. A fourth FK with a mutating
      // action would be a fourth path, and this is what refuses to let it ship
      // unnamed. `performed_by` and `org_id` are NO ACTION and so are not one.
      expect(keys.filter((k) => RI_MUTATING.test(k.onDelete))).toEqual([
        { column: "booking_id", parent: "bookings", onDelete: "set null" },
      ]);
    });

    // The show date is what makes that FK reachable, and it is reachable by a
    // user rather than only by a platform administrator: bookings cascade from
    // show_dates, and show_dates carries a live DELETE policy for org admins.
    // If either half goes away, the published claim may drop "show-date".
    it("keeps the show-date deletion that reaches it reachable and named", () => {
      expect(
        foreignKeys("bookings").find((k) => k.column === "show_date_id"),
      ).toEqual({ column: "show_date_id", parent: "show_dates", onDelete: "cascade" });

      const deletePolicy = FILES.some((f) =>
        /create policy[^;]*on public\.show_dates for delete/i.test(f.sql),
      );
      expect(deletePolicy, "no DELETE policy on show_dates — is this path still reachable?").toBe(true);
    });

    // The three derivations above, joined to the three published strings. The
    // claim and both matrix cells have to name every path, because the public
    // page renders `evidence` only in Full inventory mode.
    it("names all three paths in every string a Summary reader sees", () => {
      const control = CONTROLS.find((c) => c.title === "Auditability")!;
      const row = VISIBILITY_MATRIX.find((r) => r.object === "Booking audit log")!;
      for (const [where, text] of [
        ["the Auditability claim", control.claim],
        ["the audit-log cell (admin)", row.admin.note],
        ["the audit-log cell (production team)", row.producer.note],
      ] as const) {
        expect(text, `${where} does not name the account path`).toMatch(/account/i);
        expect(text, `${where} does not name the show-date path`).toMatch(/show[- ]date/i);
        expect(text, `${where} does not name the organisation path`).toMatch(/organisation/i);
        // And no exhaustive quantifier, which is what made the last correction
        // false rather than merely incomplete.
        expect(text, `${where} makes an exhaustive claim again`).not.toMatch(/\bonly\b/i);
      }
      // The citation stays in evidence, where a reviewer can act on it.
      expect(control.evidence).toMatch(/ON DELETE SET NULL/i);
    });
  });
});

describe("the published Auditability control", () => {
  const control = CONTROLS.find((c) => c.title === "Auditability");
  const matrixRow = VISIBILITY_MATRIX.find((r) => r.object === "Booking audit log");

  it("scopes the claim to status changes and names the automated path", () => {
    expect(control, "CONTROLS has no 'Auditability' entry").toBeDefined();
    expect(control!.claim).toContain("Every change to a booking's status is appended to a log");
    // Both limitations stay in `claim` rather than moving to `evidence` when
    // the claim was shortened, because the public page renders `evidence` only
    // in Full inventory mode: a Summary reader who meets "who acted" with no
    // qualifier has been told something that is false for every automated
    // transition. Case-insensitive because the automated-path clause now sits
    // mid-sentence rather than opening one.
    expect(control!.claim).toMatch(/automated transitions/i);
    expect(control!.claim).toContain("no person to record as the actor");
    // The limitation, stated rather than left to be discovered.
    expect(control!.claim).toContain("Nothing else about a booking is logged");
  });

  it("cites the two functions a reviewer would have to read", () => {
    expect(control!.evidence).toContain("notify_booking_transition");
    expect(control!.evidence).toContain("promote_understudy_on_cancellation");
    // The worked example of the limitation moved here from the claim. It is
    // detail rather than a qualifier — the claim still states the limitation —
    // but it is the sentence that makes it concrete, so it must not evaporate.
    expect(control!.evidence).toContain("leaves no row");
  });

  // "No policy permits an update or a delete" was true at the policy layer and
  // read as immutability at the system layer, which is exactly the
  // true-but-misleading shape this page rewrote "checked in the database" into
  // a 19/6/3 split to avoid. Both the card and the matrix pill made it. This is
  // what stops either of them making it again: the SUMMARY-visible sentence
  // (`claim`, and the matrix cell — the public page hides `evidence` behind
  // Full inventory) has to name the exception, and neither may state the
  // policy fact as though it settled the question.
  // (Which paths those are, and that the published strings name all of them,
  // is derived from the schema in the block above. This one only holds the
  // rule about WHERE the policy fact may be stated.)
  it("does not let the append-only claim read as immutability", () => {
    for (const [where, text] of [
      ["the Auditability claim", control!.claim],
      ["the Booking audit log matrix cell", matrixRow!.admin.note],
      ["the Booking audit log matrix cell", matrixRow!.producer.note],
    ] as const) {
      expect(text, `${where} states the policy fact as though it settled it`).not.toMatch(
        /no policy (permits|allows) an? (update|edit)/i,
      );
    }
    // The policy fact is not dropped, only relocated to where a reviewer can
    // act on it: beside the three things that get past it.
    expect(control!.evidence).toMatch(/no policy grants an update or a delete/i);
    expect(control!.evidence).toContain("anonymize_user");
    expect(control!.evidence).toContain("delete_org");
  });

  // The pill still says "Append-only", and that is correct: the Access column
  // answers what a ROLE can do, and neither role can update or delete. The
  // width of that column is a declared 108px justified against this exact
  // string, so a well-meaning rewrite to something longer would break the
  // fixed layout rather than the claim.
  it("keeps the append-only answer on the role, where it is true", () => {
    expect(matrixRow, "the Booking audit log matrix row was renamed").toBeDefined();
    expect(matrixRow!.admin.value).toBe("Append-only");
    expect(matrixRow!.producer.value).toBe("Append-only");
  });
});
