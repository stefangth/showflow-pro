// The Trust Center's density contract.
//
// Nothing used to pin how LONG a claim could be, and the page paid for it in
// two ways a reader can see. Measured on the public page at 1440 before this
// file existed:
//
//  - the six `CONTROLS` claims ran 29 to 126 words. In a three-across grid of
//    content-height cards that 97-word spread left 223px of empty card in row
//    one and 180px in row two, and "Roles and rights" was fifteen lines of
//    body copy in Summary — the view a reviewer picks because they want less.
//  - the eight matrix mechanism cells ran 12 to 135 characters. Both surfaces
//    laid the table out `auto`, so the widest cell took the width and squeezed
//    the Data column to 145px at 1024, wrapping five of eight row labels and
//    producing row heights of 49 / 57 / 65 / 72 / 85 / 89px in one table.
//
// Both surfaces now lay that table out `fixed` with one row height, so an
// over-long cell no longer squeezes its neighbours — it silently breaks the
// rhythm instead, which is harder to notice and just as bad. Hence a test.
//
// WHAT THIS FILE IS NOT. It is a rhythm gate, not a licence to trim a claim
// until it fits. Every qualifier that stops a sentence over-claiming has to
// survive in `claim`, because the public page renders `evidence` only in Full
// inventory mode; only detail that enriches a true sentence may move.
//
// The last TWO describe blocks are what enforce that, and there are two of them
// for a reason. The first pins the `claim` qualifiers earlier audit rounds
// proved were needed. The second pins `evidence`, and it exists because the
// caps below were once applied to `evidence` WITHOUT that clause-by-clause read
// and compressed the scope out of a citation. A ceiling can be enforced by
// counting; whether a sentence still says what it must cannot.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROLS, RETENTION, VISIBILITY_MATRIX } from "./facts";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** One assertion, three to four rendered lines in a three-across card. */
const CLAIM_MAX_WORDS = 45;
/** The void a row of cards carries is set by the SPREAD, not by the ceiling:
 *  six 45-word claims leave no hole, and a 45 beside a 15 leaves a big one. */
const CLAIM_SPREAD_MAX_WORDS = 20;
const EVIDENCE_MAX_WORDS = 50;
/** Two lines in the narrowest Mechanism column either surface declares. */
const NOTE_MAX_CHARS = 110;
/** Wider than this and the Data column has to grow past the width the
 *  narrowest fixed layout can give it, which is where label wrapping starts. */
const LABEL_MAX_CHARS = 32;
/** A right-aligned mono value sharing a line with its key. Longer than this
 *  and it wraps, taking the key with it, in every card under about 520px. */
const PERIOD_MAX_CHARS = 40;

describe("control cards hold a readable length", () => {
  it.each(CONTROLS)(`$title states its claim in ${CLAIM_MAX_WORDS} words or fewer`, (control) => {
    expect(words(control.claim), `"${control.title}" claim is ${words(control.claim)} words`).toBeLessThanOrEqual(
      CLAIM_MAX_WORDS,
    );
  });

  it.each(CONTROLS)(`$title cites its evidence in ${EVIDENCE_MAX_WORDS} words or fewer`, (control) => {
    expect(
      words(control.evidence),
      `"${control.title}" evidence is ${words(control.evidence)} words`,
    ).toBeLessThanOrEqual(EVIDENCE_MAX_WORDS);
  });

  it("keeps the six claims within one card-height of each other", () => {
    const lengths = CONTROLS.map((c) => words(c.claim));
    const spread = Math.max(...lengths) - Math.min(...lengths);
    expect(spread, `claim lengths are ${lengths.join(", ")} words`).toBeLessThanOrEqual(
      CLAIM_SPREAD_MAX_WORDS,
    );
  });
});

describe("the access matrix holds a fixed row rhythm", () => {
  const cells = VISIBILITY_MATRIX.flatMap((row) => [
    { object: row.object, role: "admin", note: row.admin.note },
    { object: row.object, role: "producer", note: row.producer.note },
    { object: row.object, role: "artist", note: row.artist.note },
  ]);

  it.each(cells)("$object / $role fits two lines of the Mechanism column", ({ note }) => {
    expect(note.length, `"${note}" is ${note.length} characters`).toBeLessThanOrEqual(NOTE_MAX_CHARS);
  });

  it.each(VISIBILITY_MATRIX)("$object fits the Data column without wrapping", ({ object }) => {
    expect(object.length, `"${object}" is ${object.length} characters`).toBeLessThanOrEqual(
      LABEL_MAX_CHARS,
    );
  });
});

describe("retention values stay on one line beside their key", () => {
  it.each(RETENTION)(`$item prints a period of ${PERIOD_MAX_CHARS} characters or fewer`, ({ period }) => {
    expect(period.length, `"${period}" is ${period.length} characters`).toBeLessThanOrEqual(
      PERIOD_MAX_CHARS,
    );
  });

  // The conditions themselves are not gone — they are the second sentence of
  // each row's `basis`, which renders directly underneath. What must not come
  // back is a condition in the VALUE column, where it reads as a roadmap entry
  // in a column of present-tense figures and wraps the key with it.
  it.each(RETENTION)("$item states a period, not a plan", ({ period, basis }) => {
    expect(period).not.toMatch(/\bonce\b|\bwhen\b|\bif\b|\bwill\b|\bplanned\b/i);
    expect(basis.length, "a row with no basis has nowhere to put its condition").toBeGreaterThan(0);
  });
});

// The half of this contract that a word count cannot express. Each of these
// clauses was added by an audit round that proved the sentence was false or
// misleading without it, so each is load-bearing and none may be traded for
// length. If one of these fails, the fix is a shorter sentence that still
// carries the clause — never a shorter sentence that drops it.
describe("shortening did not cost a qualifier", () => {
  const claim = (title: string) => CONTROLS.find((c) => c.title === title)!.claim;

  it("keeps the four-table exception on the tenant-isolation claim", () => {
    // supabase/tests/rls/org_coverage.sql excludes four org_id-carrying tables
    // from the org_isolation assertion by name. "One restrictive policy on
    // every table" is false without this, and its own cited evidence says so.
    expect(claim("Tenant isolation")).toMatch(/four named tables sit outside/i);
  });

  it("keeps the interface-only carve-out on the roles claim", () => {
    // Three of the 28 rights have no server-side check. A Summary reader who
    // meets "checked on the server" with no carve-out has been over-claimed at.
    expect(claim("Roles and rights")).toMatch(/only by the interface/i);
  });

  it("keeps the two nines distinguishable on the roles claim", () => {
    // Two nines side by side read as one set. They are not: issuing and
    // voiding hire orders are sensitive yet ship on.
    expect(claim("Roles and rights")).toMatch(/a different nine|different sets?/i);
  });

  it("keeps both audit-log limitations on the auditability claim", () => {
    // notify_booking_transition returns without writing unless the status
    // changed, and the automated promotion passes a NULL actor.
    expect(claim("Auditability")).toMatch(/nothing else about a booking is logged/i);
    expect(claim("Auditability")).toMatch(/no person to record as the actor/i);
  });

  it("keeps the backup ceiling framed as a ceiling", () => {
    // "Rolling 30 days" read as a durability promise nobody could keep.
    expect(claim("Backups")).toMatch(/deletion ceiling, not a promise/i);
  });
});

// The block above covers `claim` only, and that gap has already cost once: the
// word cap this file introduced was applied to `evidence` without the same
// clause-by-clause read, and it compressed "on shows and show_dates" out of the
// tenant-isolation citation — turning a two-table result into a sentence that
// reads as table-agnostic. A ceiling can be enforced by counting; whether a
// sentence still says what it must cannot. So the citations that carry a scope
// or a mechanism get pinned here too.
describe("evidence citations still say what they cite", () => {
  const evidence = (title: string) => CONTROLS.find((c) => c.title === title)!.evidence;

  // Derived from the file, not from a remembered pair of names. If a third
  // table is added to org_isolation.sql the citation is now too narrow and this
  // fails; if one is removed it is too broad and this fails. Either way the
  // sentence and the artefact move together.
  it("names every tenant table org_isolation.sql actually exercises", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/tests/rls/org_isolation.sql"), "utf8");
    const counts = new Map<string, number>();
    for (const match of sql.matchAll(/\bpublic\.([a-z_]+)/g)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
    // A table referenced once is fixture setup (platform_admins, organizations,
    // org_memberships each appear exactly once, to build the two orgs and their
    // roles). A table the test asserts against appears repeatedly.
    const exercised = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .map(([table]) => table)
      .sort();
    expect(exercised, "org_isolation.sql's assertion surface changed").toEqual([
      "show_dates",
      "shows",
    ]);
    for (const table of exercised) {
      expect(
        evidence("Tenant isolation"),
        `the citation must name ${table}, or it reads as a table-agnostic result`,
      ).toContain(table);
    }
  });

  it("cites the grant behind the secrets claim, not just 'admin-guarded'", () => {
    // The claim says integration keys are "readable only by server functions,
    // never by members of your organisation". That is a GRANT
    // (20260604131000_org_airtable_vault.sql:38-40 revokes EXECUTE on the
    // reader from authenticated and grants it to service_role), and a grant is
    // what a reviewer can check. "Written through an admin-guarded function"
    // describes the writer and leaves the reader unevidenced.
    expect(evidence("Encryption and secrets")).toContain("get_org_airtable_key");
    expect(evidence("Encryption and secrets")).toMatch(/revoked from authenticated/i);
  });

  it("keeps the auditability citation pointing at both trigger paths", () => {
    // The claim concedes that automated transitions record no actor; the
    // citation is what says which function takes that path.
    expect(evidence("Auditability")).toContain("notify_booking_transition");
    expect(evidence("Auditability")).toContain("promote_understudy_on_cancellation");
  });
});
