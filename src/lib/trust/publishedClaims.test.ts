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
  DOCUMENTS_NOTE,
  RETENTION,
  RETENTION_BASIS_NOTE,
  SELF_SERVE_RIGHTS,
  SUBPROCESSORS,
  TRANSFER_BASIS_NOTE,
  TRUST_KPIS,
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
// This clause has been wrong twice, in opposite directions.
//
// First: "In the app, Manage cookie preferences turns off analytics, session
// replay, and error tracking if and when any of them is enabled" — three
// defects, one of them the forward-looking framing this page does not do.
//
// Then, correcting it: "The app records a separate choice … and loads none of
// the three". True of the dependency tree, and it was the honest reading while
// the subprocessor table carried PostHog at "Off". It is at
// "Consent" now — named as a processor that receives data once a reader accepts
// — so a right that tells the same reader nothing is loaded contradicts the
// section above it.
//
// What is left is the right itself: three separate choices, changeable at any
// time. That is what Art. 7(3) is about, and it asserts no mechanism this
// repository cannot show.
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
    // repo by src/analyticsConsent.test.ts), and it is the one withdrawal this
    // repository can point at end to end.
    expect(right!.detail).toMatch(/showflow\.pro/);
    expect(right!.detail).toMatch(/Cookie settings/);
  });

  it("names all three app-side choices and the control that changes them", () => {
    for (const category of ["analytics", "session replay", "error tracking"]) {
      expect(right!.detail.toLowerCase(), `the ${category} choice is not named`).toContain(category);
    }
    // The control exists and is reachable: PrivacyPage renders it, and the
    // banner mounted in App.tsx opens the same dialog.
    expect(right!.detail).toMatch(/Manage cookie preferences/);
    const privacyPage = readFileSync(resolve(ROOT, "src/pages/PrivacyPage.tsx"), "utf8");
    expect(privacyPage).toContain("Manage cookie preferences");
    expect(privacyPage).toContain("openPreferences");
  });

  it("no longer denies collection the subprocessor table discloses", () => {
    // The specific regression: this clause and SUBPROCESSORS are two sections
    // apart on one page, and they must not disagree about whether the app's
    // three categories are collected at all.
    expect(right!.detail).not.toMatch(/loads none of the three/i);
    expect(SUBPROCESSORS.find((s) => s.name === "PostHog")?.status).not.toBe("Off");
  });
});

// ── The mechanism the repository cannot show ──────────────────────────────
//
// PostHog is disclosed as the processor that receives product analytics,
// session replay, and error reports after consent. posthog-js is now installed
// and consent-gated (src/features/analytics/), but nothing committed here
// proves the deployment wiring end to end — no environment key, no hosting
// setting. The honest way to hold that residual gap is to describe the
// PROCESSING and the GATE — both of which the privacy policy asserts — and
// never claim more of the implementation than the tree can show.
//
// So: derive the premise, then ban the sentence that would fill the gap with an
// invention — but only for as long as the gap exists. An earlier revision
// asserted the absence outright, which made this a tripwire on somebody else's
// work: PostHog was being integrated in a separate branch, and the moment that
// merged a hard "no tracker is installed" assertion failed the build for a
// change that did nothing wrong. The ban is the part worth keeping, so it is
// now conditional on the premise rather than asserting it.
//
// When a tracker does ship, the honest move is to describe how it actually
// works, which this guard then stops policing. Re-read the published claims at
// that point rather than leaving them at the deliberately mechanism-free
// wording they carry today.
const INSTALLED_TRACKERS = (() => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return installed.filter((p) => /sentry|posthog/i.test(p));
})();

describe("no published claim asserts a client integration this repository does not carry", () => {
  it.runIf(INSTALLED_TRACKERS.length === 0)("describes no SDK, package, or script in public/trust.json", () => {
    const contract = JSON.parse(readFileSync(resolve(ROOT, "public/trust.json"), "utf8")) as unknown;
    const strings: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === "string") strings.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(contract);
    expect(strings.length, "the contract walk found no strings").toBeGreaterThan(50);

    const MECHANISM = /\b(SDK|npm|script tag|is loaded into|loads the tracker)\b/i;
    const offenders = strings.filter((s) => MECHANISM.test(s));
    expect(
      offenders,
      "a published claim describes a client integration nothing in this repository shows",
    ).toEqual([]);
  });
});

// ── The register the public page is written in ────────────────────────────
//
// Every string in this block renders on showflow.pro/trust, where the reader
// is a prospective customer rather than an auditor with the repository open.
// Naming the file, function, constant or typeface behind a claim spends
// precision on the wrong question: it answers "which line of code does this"
// when the reader asked "what are you promising me".
//
// `Control.evidence` is deliberately NOT in this set. It is the audit trail,
// it still names everything it always named, and it is no longer rendered on
// the public page at all — the landing repo's Trust.tsx dropped it. The
// separation is the whole point: the citations survive, in the one field that
// does not face the public.
describe("no publicly rendered claim names the code behind it", () => {
  /** The strings the public trust page actually renders. */
  function publicStrings(): { where: string; text: string }[] {
    const out: { where: string; text: string }[] = [];
    for (const kpi of TRUST_KPIS) out.push({ where: `kpi ${kpi.label}`, text: kpi.value });
    for (const control of CONTROLS) out.push({ where: `control ${control.title}`, text: control.claim });
    for (const row of VISIBILITY_MATRIX) {
      for (const role of ["admin", "producer", "artist"] as const) {
        out.push({ where: `matrix ${row.object} / ${role}`, text: row[role].note });
      }
    }
    out.push({ where: "crossOrgExceptionsNote", text: CROSS_ORG_EXCEPTIONS_NOTE });
    for (const sub of SUBPROCESSORS) {
      out.push({ where: `subprocessor ${sub.name} purpose`, text: sub.purpose });
      out.push({ where: `subprocessor ${sub.name} transfer`, text: sub.transfer });
    }
    for (const retention of RETENTION) {
      out.push({ where: `retention ${retention.item} period`, text: retention.period });
      out.push({ where: `retention ${retention.item} basis`, text: retention.basis });
    }
    for (const right of SELF_SERVE_RIGHTS) out.push({ where: `right ${right.title}`, text: right.detail });
    out.push({ where: "TRANSFER_BASIS_NOTE", text: TRANSFER_BASIS_NOTE });
    out.push({ where: "RETENTION_BASIS_NOTE", text: RETENTION_BASIS_NOTE });
    out.push({ where: "DOCUMENTS_NOTE", text: DOCUMENTS_NOTE });
    return out;
  }

  it("collects the whole public surface, so the assertions below cannot pass vacuously", () => {
    expect(publicStrings().length).toBeGreaterThan(40);
  });

  /** A path (`src/config/app.config.ts`), a snake_case identifier
   *  (`prune_email_log`), a SCREAMING_SNAKE constant (`CHAT_ARCHIVE_DAYS`), or
   *  a kebab-case edge-function folder (`delete-my-account`). */
  const IDENTIFIER =
    /\b[A-Za-z0-9_]+\.(?:tsx?|jsx?|sql|mjs|cjs|json|md|toml|ya?ml)\b|\b[a-z0-9]+(?:\/[a-z0-9._-]+)+\b|\b[a-z]+(?:_[a-z0-9]+)+\b|\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|\b[a-z]+-my-[a-z]+\b/;

  it.each(publicStrings())("$where names no file, function, or constant", ({ text }) => {
    const hit = text.match(IDENTIFIER);
    expect(hit?.[0], `"${text}" names ${hit?.[0]}`).toBeUndefined();
  });

  /** Typeface families we serve. Naming which ones on a trust page was the
   *  owner's worked example of specificity spent in the wrong place. */
  const TYPEFACES = /\bGeist(?:\s+Mono)?\b/;

  it.each(publicStrings())("$where names no typeface", ({ text }) => {
    expect(text, `"${text}" names a typeface`).not.toMatch(TYPEFACES);
  });
});

// ── The dash gate ─────────────────────────────────────────────────────────
//
// Product copy in this repo carries no em-dashes and no en-dashes. There was
// no mechanical guard for it in either repo, and an em-dash had reached the
// in-app Trust tab as a tile's whole value. public/trust.json is the cheapest
// place to enforce it that covers real reach: it is every string facts.ts
// publishes, on both surfaces, with no source comments in it to produce false
// positives.
//
// EN-DASHES USED TO BE EXEMPT here, on the grounds that the two that shipped
// ("7–30 days", "EU–US Data Privacy Framework") were mirrored from the privacy
// policy and so could not move without the policy moving with them. The owner
// has since ruled the other way: both were rewritten with ASCII hyphens in
// both policy files, in facts.ts, and in this suite's sibling anchors, and the
// German policy had already been writing "EU-US" that way. So the exemption is
// gone and the gate covers both characters — a range or a compound in a
// published claim uses a hyphen.
describe("the published contract carries no em-dashes or en-dashes", () => {
  it("finds none in public/trust.json", () => {
    const raw = readFileSync(resolve(ROOT, "public/trust.json"), "utf8");
    const lines = raw.split("\n").filter((l) => /[—–]/.test(l));
    expect(lines, "an em-dash or en-dash reached a published claim").toEqual([]);
  });
});
