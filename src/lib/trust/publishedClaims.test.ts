// Three claim-shape guards that no other file in this suite can hold, plus one
// mechanical dash gate over the whole published contract.
//
// They live together because they share a premise: every one of them exists
// because a sentence that READ correctly was false, and the previous round's
// fix for it did not survive. The C1 guard in particular is a recurrence — the
// blocked-dates "nobody outside the organisation reads them" claim was caught,
// corrected, and came back — so it is pinned to the SQL that makes it false
// rather than to the string that was wrong.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "@/lib/capabilities";
import {
  CONTROLS,
  CROSS_ORG_EXCEPTIONS_NOTE,
  SELF_SERVE_RIGHTS,
  VISIBILITY_MATRIX,
} from "./facts";

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/** Migration filenames in apply order (filenames are timestamps). */
const FILES = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** The body of the LAST `create or replace function public.<name>` in apply
 *  order — the definition production actually runs. Both helpers below have
 *  been replaced more than once, so an unfiltered grep would happily assert
 *  against a superseded body. */
function latestFunctionBody(name: string): string {
  const pattern = new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i");
  const owner = [...FILES]
    .reverse()
    .find((f) => pattern.test(readFileSync(join(MIGRATIONS, f), "utf8")));
  expect(owner, `no migration defines public.${name}`).toBeDefined();

  const sql = readFileSync(join(MIGRATIONS, owner!), "utf8");
  const chunks = sql.split(pattern);
  const body = chunks[chunks.length - 1];
  const end = body.indexOf("$$;");
  return end === -1 ? body : body.slice(0, end);
}

/** Every sentence this page publishes about who can read what: the matrix
 *  mechanism cells, the control claims and citations, and the footnote under
 *  the matrix. Deliberately NOT the comments — those may say "nobody". */
function publishedAccessClaims(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const row of VISIBILITY_MATRIX) {
    for (const role of ["admin", "producer", "artist"] as const) {
      out.push({ where: `matrix ${row.object} / ${role}`, text: row[role].note });
    }
  }
  for (const control of CONTROLS) {
    out.push({ where: `control ${control.title} claim`, text: control.claim });
    out.push({ where: `control ${control.title} evidence`, text: control.evidence });
  }
  out.push({ where: "crossOrgExceptionsNote", text: CROSS_ORG_EXCEPTIONS_NOTE });
  return out;
}

// ── C1 ────────────────────────────────────────────────────────────────────
//
// The blocked-dates artist cell said "nobody outside the organisation reads
// them". `public.is_org_member` opens `select public.is_super_admin(_uid) or …`,
// so the RESTRICTIVE org_isolation policy on blocked_dates does not filter a
// platform administrator, and `public.has_org_role` opens the same way, so the
// permissive "Admins and producers can view blocked_dates" SELECT policy admits
// one too. blocked_dates carries no compensating predicate, and the repo proves
// the equivalent affirmatively one table over
// (supabase/tests/rls/artists_contact_privacy.sql: "super-admin CAN read an
// artist's email (god mode)").
//
// Dropping the ShowFlow-staff column from the table is silence and is fine. An
// affirmative absolute is a claim, and it is the only kind of sentence on this
// page that can reach past the three roles the table declares. So: pin the
// premise to the SQL, then ban the shape.
describe("no published claim asserts an absolute nobody can read", () => {
  // The premise. If BOTH of these ever stop short-circuiting on super-admin,
  // an absolute may be defensible again — and this test is where you would
  // find out, rather than in an audit round.
  it.each(["is_org_member", "has_org_role"])(
    "%s still admits a platform administrator, which is what makes an absolute false",
    (fn) => {
      expect(
        latestFunctionBody(fn),
        `public.${fn} no longer calls is_super_admin — re-read the absolutes below before widening one`,
      ).toMatch(/is_super_admin/);
    },
  );

  // The shape, not the string. "nobody outside the organisation" was the
  // wording that shipped twice; banning that exact phrase would catch the
  // third occurrence only if it were spelled the same way. Every absolute
  // quantifier is banned instead, because none of them can be true of a page
  // whose two membership helpers both open with is_super_admin.
  const ABSOLUTE = /\b(nobody|no one|no-one|not a single|nobody else)\b/i;

  it.each(publishedAccessClaims())("$where states no absolute", ({ text }) => {
    expect(text, `"${text}" uses an absolute quantifier`).not.toMatch(ABSOLUTE);
  });

  // The positive half: the blocked-dates denial must still BE a denial, scoped
  // to organisations. Banning "nobody" without this would be satisfied by
  // deleting the clause, which trades an over-claim for silence about the one
  // thing an artist reading that row wants to know.
  it("scopes the blocked-dates denial to other organisations rather than dropping it", () => {
    const row = VISIBILITY_MATRIX.find((r) => r.object === "Availability and blocked dates");
    expect(row, "the blocked-dates row was renamed").toBeDefined();
    expect(row!.artist.note).toMatch(/no other organisation/i);
  });
});

// ── The quoted right names ────────────────────────────────────────────────
//
// The matrix told a reader to look for the "edit artists" right. That is the
// ACTION KEY; Settings > Roles and permissions renders `CapabilityDef.label`,
// which is "Edit artist details, skills, and status". A reader following the
// instruction finds no such row. Derived rather than spot-checked, so a right
// renamed in the registry turns this red instead of leaving the page pointing
// at a control that no longer exists under that name.
describe("every right the matrix quotes is a right Settings shows", () => {
  const LABELS = new Set(CAPABILITY_DEFS.map((d) => d.label));
  const quoted = VISIBILITY_MATRIX.flatMap((row) =>
    (["admin", "producer", "artist"] as const).flatMap((role) =>
      [...row[role].note.matchAll(/"([^"]+)"\s+right/g)].map((m) => ({
        where: `${row.object} / ${role}`,
        name: m[1],
      })),
    ),
  );

  it("finds the quoted names at all, so the assertion below cannot pass vacuously", () => {
    expect(quoted.length).toBeGreaterThan(0);
  });

  it.each(quoted)("$where quotes a registry label", ({ name }) => {
    expect(
      LABELS.has(name),
      `"${name}" is not a CapabilityDef label — Settings shows one of: ${[...LABELS].join(" | ")}`,
    ).toBe(true);
  });
});

// ── The withdrawal right ──────────────────────────────────────────────────
//
// "In the app, Manage cookie preferences turns off analytics, session replay,
// and error tracking if and when any of them is enabled" was wrong three ways:
// the control is on the public privacy page and the login page rather than
// inside the signed-in app, nothing reads the stored consent to load or unload
// a tracker, and "if and when" is the forward-looking framing this page does
// not do. The replacement states only what is true today, and the premise
// behind it is re-derived here so it goes red the day a tracker ships instead
// of quietly becoming an under-claim.
describe("the consent-withdrawal right describes what exists today", () => {
  const right = SELF_SERVE_RIGHTS.find((r) => r.title === "Withdraw analytics consent");

  it("is still published", () => {
    expect(right, "the withdrawal right was renamed or removed").toBeDefined();
  });

  it("makes no forward-looking promise", () => {
    expect(right!.detail).not.toMatch(/\bif and when\b|\bonce\b|\bwill be\b|\bplanned\b/i);
  });

  it("credits the withdrawal to the surface that actually has something to stop", () => {
    // The landing site's beacon is real (its beforeSend gate is pinned in that
    // repo by src/analyticsConsent.test.ts). Naming it is what stops the
    // app-side concession reading as "no analytics anywhere".
    expect(right!.detail).toMatch(/showflow\.pro/);
    expect(right!.detail).toMatch(/Cookie settings/);
  });

  it("concedes that the app loads none of the three, and is right about it", () => {
    expect(right!.detail).toMatch(/loads none of the three/i);

    // The premise. An analytics, session-replay or error-tracking package
    // landing in the app makes that concession false, and this is the only
    // assertion that would notice.
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(installed.filter((p) => /sentry|posthog|analytics|replay/i.test(p))).toEqual([]);
  });
});

// ── The dash gate ─────────────────────────────────────────────────────────
//
// Product copy in this repo carries no em-dashes. There was no mechanical
// guard for it in either repo, and an em-dash had reached the in-app Trust tab
// as a tile's whole value. public/trust.json is the cheapest place to enforce
// it that covers real reach: it is every string facts.ts publishes, on both
// surfaces, with no source comments in it to produce false positives.
//
// EN-DASHES ARE NOT BANNED HERE. Two of them ("7–30 days", "EU–US Data Privacy
// Framework") are mirrored from the privacy policy and are asserted against it
// by facts.privacy.test.ts, so they cannot move without both policies moving
// with them. That is an owner decision, not a copy slip.
describe("the published contract carries no em-dashes", () => {
  it("finds none in public/trust.json", () => {
    const raw = readFileSync(resolve(ROOT, "public/trust.json"), "utf8");
    const lines = raw.split("\n").filter((l) => l.includes("—"));
    expect(lines, "an em-dash reached a published claim").toEqual([]);
  });
});
