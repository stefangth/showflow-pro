// facts.ts is a claim table whose whole premise is that every sentence points
// at something a reviewer can open. It cites files constantly — migrations,
// RLS tests, edge functions, components — in doc comments and inside the
// published `claim` / `evidence` strings themselves.
//
// Five separate rounds on this branch shipped a citation that pointed at a
// path which does not exist: a component that had been renamed, a test file
// that never had that name, a migration whose filename was off by a suffix.
// Every one of them was found by a human opening the path and getting
// nothing. That is the most expensive possible way to catch a typo, and none
// of the existing suites could see it — they assert what the cited files
// CONTAIN, which only works once the path is right.
//
// This closes the class. It resolves every file path facts.ts names and fails
// if one does not exist. Deliberately paths only, not line numbers: a line
// number goes stale on any edit above it, so pinning them would turn a cheap
// guard into a maintenance tax, while a wrong PATH is always a defect.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE = "src/lib/trust/facts.ts";

/** Extensions a citation in this file can carry. Longest-first where one is a
 *  prefix of another (`tsx` before `ts`, `json` before `js`) so a `.tsx`
 *  citation is never truncated to a `.ts` path that happens to exist. */
const EXTENSIONS = ["tsx", "ts", "jsx", "json", "mjs", "cjs", "js", "sql", "md", "toml", "yaml", "yml", "css", "html"];

/** A path-shaped token: zero or more `segment/` parts then `name.ext`.
 *  Bare filenames count — the migration citations are written that way, and a
 *  bare migration name is exactly the citation that broke most recently. */
const CITATION = new RegExp(
  String.raw`(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:${EXTENSIONS.join("|")})\b`,
  "g",
);

/** Files in the landing-page repository (showflow-pro.landingpage), which
 *  this repo cannot read at test time. They are cited because the Trust
 *  Center renders on both hosts and several claims are about the other half
 *  of it. Listed by name rather than skipped by pattern, so a NEW unresolved
 *  path still fails; and every entry is asserted to still be cited below, so
 *  the exemption cannot outlive the sentence that needed it. */
const LANDING_REPO_FILES = new Set([
  "src/components/CookieBanner.tsx",
  "src/pages/Tos.tsx",
  "Tos.tsx",
  "Trust.tsx",
  "scripts/check-doc-dates.mjs",
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".vercel",
]);

/** Every file in the working tree, as repo-relative paths. */
function allFiles(dir = ROOT, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...allFiles(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name));
    } else {
      out.push(prefix ? `${prefix}/${entry.name}` : entry.name);
    }
  }
  return out;
}

const FILES = allFiles();

/** The citations facts.ts makes, deduplicated and in source order.
 *
 *  URLs are stripped first. `https://app.showflow.pro/trust.json` is
 *  path-shaped but is not a path in this tree, and where the Trust Center's
 *  links point is factsUrls.test.ts's job, not this one's. */
function citations(): string[] {
  const source = readFileSync(resolve(ROOT, SOURCE), "utf8").replace(/https?:\/\/\S+/g, " ");
  return [...new Set(source.match(CITATION) ?? [])];
}

/** A citation resolves if some file in the tree IS it, or ends with it as a
 *  whole path segment — which is what makes a bare `20260603120200_….sql`
 *  resolve to its home under supabase/migrations without the comment having
 *  to spell the directory out. */
function resolves(citation: string): boolean {
  return FILES.some((file) => file === citation || file.endsWith(`/${citation}`));
}

describe("every file facts.ts cites exists", () => {
  it("finds citations at all, so a silent extractor failure cannot pass", () => {
    // If the regex or the source path ever stops matching anything, every
    // assertion below would pass vacuously. facts.ts has cited dozens of
    // files for as long as it has existed; a handful is a floor, not a target.
    expect(citations().length).toBeGreaterThan(10);
    expect(FILES.length, "the working-tree walk found nothing").toBeGreaterThan(100);
  });

  it("resolves every cited path in this repository", () => {
    const missing = citations().filter((c) => !resolves(c) && !LANDING_REPO_FILES.has(c));
    expect(
      missing,
      `${SOURCE} cites ${missing.length} path(s) that do not exist. Fix the citation, ` +
        `or add it to LANDING_REPO_FILES if it lives in the landing-page repo.`,
    ).toEqual([]);
  });

  it("keeps no exemption for a cross-repo path it has stopped citing", () => {
    const cited = new Set(citations());
    const stale = [...LANDING_REPO_FILES].filter((f) => !cited.has(f));
    expect(stale, "LANDING_REPO_FILES exempts paths facts.ts no longer names").toEqual([]);
  });

  it("does not exempt a path this repository can resolve on its own", () => {
    // An entry that resolves here is either a real file in this tree (so the
    // exemption is hiding a working check) or a name collision with one. Both
    // are reasons to take it off the list.
    const resolvable = [...LANDING_REPO_FILES].filter((f) => resolves(f));
    expect(resolvable, "these are exempted but exist in this repo").toEqual([]);
  });
});
