import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: tenant-table reads must be scoped to the ACTIVE org.
 *
 * Why this file exists.
 *
 * RLS does NOT narrow rows to the org a user is currently viewing. The RESTRICTIVE
 * `org_isolation` policy on every tenant table is `is_org_member(auth.uid(), org_id)`,
 * and that helper is `is_super_admin(_uid) OR exists(membership)`. So it is true for
 * EVERY org for a super-admin, and true for every org a multi-org member belongs to.
 * Several tables (`casts`, `cast_members`, `shows`, `show_dates`, `cities`, `skills`, …)
 * additionally carry a PERMISSIVE `SELECT ... USING (true)`, which leaves `org_isolation`
 * as their only row filter.
 *
 * ADR-0003 states this deliberately: "Isolation never depends on the active-org UI
 * filter … RLS guarantees a session can only ever read orgs it BELONGS TO." Narrowing
 * from "orgs I may read" to "the org I am viewing" is the client's job.
 *
 * A single forgotten `.eq("org_id", orgId)` therefore renders another org's data — which
 * is exactly the bug this suite was written for (a super-admin entering a fresh org still
 * saw the previous org's bookings and casts). The mistake is invisible in single-org dev
 * data, so it needs a machine to catch it.
 *
 * Two rules:
 *
 *   1. SAFETY (everywhere): every tenant-table SELECT carries either an org filter or a
 *      UUID-FK filter. A UUID belongs to exactly one org, so `.eq("show_date_id", …)` is
 *      inherently org-safe; an unqualified list read is not. This is the rule that
 *      actually prevents the bug.
 *
 *   2. LOCATION (list reads only): a SELECT whose only scoping is the org filter — i.e.
 *      a list read — must live in `src/data/**`, where it is testable against
 *      `supabaseFake` and reviewable in one place. UUID-scoped reads and writes may
 *      still sit inline; migrating those too is desirable but is not what stops a leak.
 */

const SRC = "src";
const DATA_DIR = join("src", "data");
const TYPES_FILE = "src/integrations/supabase/types.ts";

/**
 * Call sites deliberately exempt from rule 1, each with the reason it is safe.
 * Keep this list short and justified — it is the escape hatch, not a dumping ground.
 */
const FROM_ALLOWLIST: Record<string, string> = {
  // Realtime-only module: subscribes to table changes, issues no select.
  "src/features/auth/realtimeInvalidations.ts": "table names in a realtime→query-key map, not queries",
};

/** Tables whose reads are legitimately cross-org, so rule 2 does not apply. */
const CROSS_ORG_BY_DESIGN = new Set([
  // The platform console reads these across every org (super-admin surfaces), and
  // `app_settings` additionally holds org_id IS NULL platform defaults.
  "app_settings",
  "org_entitlements",
  "org_capabilities",
  "org_capability_policies",
  // Per-user, not per-org: scoped by user_id, and super-admins get org_id IS NULL rows.
  "notifications",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Tables that carry an `org_id` column, read straight off the generated types. */
function tenantTables(typesSrc: string): Set<string> {
  const tables = new Set<string>();
  // Each table block looks like:  `      <name>: {\n        Row: {\n          …\n        }`
  const blockRe = /^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(typesSrc)) !== null) {
    const [, table, rowBody] = m;
    if (/^ {10}org_id\??:/m.test(rowBody)) tables.add(table);
  }
  return tables;
}

/** Every `.from("<table>")` occurrence in a source file, with its 1-based line. */
function fromCalls(src: string): { table: string; line: number; index: number }[] {
  const hits: { table: string; line: number; index: number }[] = [];
  const re = /\.from\(\s*["'`](\w+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    hits.push({ table: m[1], line: src.slice(0, m.index).split("\n").length, index: m.index });
  }
  return hits;
}

/**
 * The statement a `.from(...)` belongs to: from the call to the next `;` at or after it.
 * Good enough for this codebase's one-statement-per-query style, and deliberately
 * conservative — a missed terminator just widens the window we search for a filter.
 */
function statementAt(src: string, index: number): string {
  const end = src.indexOf(";", index);
  return src.slice(index, end === -1 ? src.length : end);
}

const ORG_FILTER = /org_id/;
/**
 * `.eq("id", …)`, `.eq("show_date_id", …)`, `.in("cast_id", …)`, `.match({ id: … })` — all
 * UUID-scoped, hence inherently org-safe. `org_id` is deliberately excluded: it is the org
 * filter, not a row-identifying FK, and counting it here would make the location rule below
 * accept any inline list read.
 */
const UUID_FILTER = /\.(?:eq|in)\(\s*["'`](?:id|(?!org_id)\w+_id)["'`]|\.match\(/;
/** A write (insert/update/upsert/delete) is scoped by its payload or its id filter, not by a list filter. */
const IS_WRITE = /\.(?:insert|update|upsert|delete)\(/;

describe("tenant-table reads are scoped to the active org", () => {
  const typesSrc = readFileSync(TYPES_FILE, "utf8");
  const TENANT = tenantTables(typesSrc);
  const files = walk(SRC).map((f) => relative(".", f));

  it("derives the tenant-table set from the generated types", () => {
    // Sanity-check the parser itself: if types.ts ever changes shape and this
    // silently matches nothing, every rule below would vacuously pass.
    expect(TENANT.size).toBeGreaterThan(20);
    for (const t of ["bookings", "casts", "cast_members", "shows", "show_dates", "artists"]) {
      expect(TENANT.has(t)).toBe(true);
    }
  });

  /** Every tenant-table select in the tree, classified. */
  function selects() {
    const out: { file: string; table: string; line: number; stmt: string }[] = [];
    for (const file of files) {
      if (FROM_ALLOWLIST[file]) continue;
      const src = readFileSync(file, "utf8");
      for (const { table, line, index } of fromCalls(src)) {
        if (!TENANT.has(table) || CROSS_ORG_BY_DESIGN.has(table)) continue;
        const stmt = statementAt(src, index);
        if (IS_WRITE.test(stmt)) continue;
        out.push({ file, table, line, stmt });
      }
    }
    return out;
  }

  it("scopes every tenant-table select by org or by a uuid FK", () => {
    const offenders = selects()
      .filter(({ stmt }) => !ORG_FILTER.test(stmt) && !UUID_FILTER.test(stmt))
      .map(({ file, table, line }) => `${file}:${line} selects "${table}" unscoped`);
    expect(
      offenders,
      "Add .eq('org_id', orgId), or scope by a uuid FK (org-safe). Without it a super-admin " +
        "or any multi-org member sees every readable org's rows — see the header of this file.",
    ).toEqual([]);
  });

  it("keeps org-filtered list reads in src/data/**", () => {
    const offenders = selects()
      .filter(({ file, stmt }) => !file.startsWith(DATA_DIR) && !UUID_FILTER.test(stmt))
      .map(({ file, table, line }) => `${file}:${line} list-reads "${table}" inline`);
    expect(
      offenders,
      "A list read is scoped only by its org filter, so it must live in src/data/<domain>.ts " +
        "as fetchX(client, orgId, …) where supabaseFake can assert the filter is present.",
    ).toEqual([]);
  });
});
