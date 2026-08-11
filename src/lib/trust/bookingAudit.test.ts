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
import { CONTROLS } from "./facts";

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

  it("never grants an update or a delete on the log", () => {
    const mutating = FILES.filter((f) =>
      /create\s+policy[\s\S]{0,200}?on\s+public\.booking_audit_log\s+for\s+(update|delete)/i.test(f.sql),
    );
    expect(mutating.map((f) => f.name)).toEqual([]);
  });
});

describe("the published Auditability control", () => {
  const control = CONTROLS.find((c) => c.title === "Auditability");

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
});
