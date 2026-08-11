// Pins the three-way enforcement split the Trust Center publishes.
//
// `CAPABILITY_INTERFACE_ONLY_NOTE` is the most self-critical sentence on both
// surfaces, and until this file existed it was the one nothing checked. Its
// previous wording named three interface-only rights after a lead-in that said
// "Most are checked in the database on write", which told a reviewer the other
// 25 carry a database policy. Six do not — they are gated only by an edge
// function, which is server-side but not "in the database", and the sentence's
// own wording makes that difference load-bearing.
//
// So the note now prints all three numbers, and this recomputes them from the
// registry, the migrations and the edge tree. Add a database policy for one of
// the three interface-only rights, or add a right with no enforcement at all,
// and the numbers move and this fails.
//
// `facts.ts` cannot import `capabilities.ts` (scripts/build-trust-json.mjs
// loads it through an import-free transpile step and throws on any import), so
// a test is the only place these counts can be pinned. Same arrangement as the
// hand-typed counts in CONTROLS[1], which capabilityInventory.test.ts pins.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "@/lib/capabilities";
import { CAPABILITY_INTERFACE_ONLY_NOTE, CONTROLS } from "./facts";

const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const FUNCTIONS = resolve(ROOT, "supabase/functions");

const KEYS = CAPABILITY_DEFS.map((d) => d.key);

function migrationFiles(): string[] {
  // Sorted by filename, which is the timestamped apply order.
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** Capabilities named directly inside an `is_capability_enabled(...)` call in a
 *  policy or an RPC guard. The function's own `create or replace` headers take
 *  a `_capability text` parameter rather than a literal, so they never match,
 *  and `capability_default`'s 28-branch CASE is a different function. */
function databaseCheckedDirectly(sql: string): Set<string> {
  const found = new Set<string>();
  for (const m of sql.matchAll(/is_capability_enabled\s*\([^;']*?'(producer_can_[a-z_]+)'\s*\)/g)) {
    found.add(m[1]);
  }
  return found;
}

/** Capabilities reached through `app_settings`' policies, which do not name a
 *  key: they call `is_capability_enabled(org_id, public.app_setting_capability(key))`
 *  and let that function map the setting key to a capability. Only the LATEST
 *  definition counts — the function has been replaced four times and an earlier
 *  body would report a mapping that no longer exists. */
function databaseCheckedViaSettingsMap(files: string[], allSql: string): Set<string> {
  const usesMap = /is_capability_enabled\s*\(\s*org_id\s*,\s*public\.app_setting_capability\(/.test(allSql);
  if (!usesMap) return new Set();

  const definitions = files.filter((f) =>
    /create or replace function public\.app_setting_capability/.test(readFileSync(join(MIGRATIONS, f), "utf8")),
  );
  expect(definitions.length, "no migration defines public.app_setting_capability").toBeGreaterThan(0);

  const latest = readFileSync(join(MIGRATIONS, definitions[definitions.length - 1]), "utf8");
  const body = latest.split("create or replace function public.app_setting_capability")[1];
  return new Set([...body.matchAll(/then\s*'(producer_can_[a-z_]+)'/g)].map((m) => m[1]));
}

/** Strip `//` and block comments so a key mentioned in prose cannot count as
 *  enforcement.
 *
 *  GUARD HOLE, closed. The scan below matched a key anywhere in a file that
 *  contained `requireCapability` anywhere, and it read the file raw — so a bare
 *  comment naming a key ("// TODO: gate producer_can_edit_scheduling here")
 *  flipped that right out of the interface-only set and out of the published
 *  three, with CI green. Proved by mutation: adding exactly that line to
 *  supabase/functions/open-offer-tier/index.ts turned the split into 19/7/2 and
 *  nothing failed except the counts, which would have been "fixed" by editing
 *  the sentence.
 *
 *  String-literal-aware rather than a naive `//` strip, because a URL inside a
 *  string ("https://…") would otherwise swallow the rest of its line. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i += 1; continue; }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Capabilities gated by `requireCapability` in an edge function. Matched by
 *  key presence in a file that imports the gate rather than by call shape,
 *  because generate-hire-orders picks its key into a variable first
 *  (`body.action === "issue" ? … : …`) and a call-site regex would miss both.
 *  `_shared/` is excluded: `_shared/capabilities.ts` is the generated registry
 *  mirror and contains all 28 keys. */
function edgeChecked(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "_shared") edgeChecked(path, out);
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    const source = stripComments(readFileSync(path, "utf8"));
    if (!source.includes("requireCapability")) continue;
    for (const key of KEYS) if (source.includes(`"${key}"`)) out.add(key);
  }
  return out;
}

function split() {
  const files = migrationFiles();
  const allSql = files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
  const database = new Set([
    ...databaseCheckedDirectly(allSql),
    ...databaseCheckedViaSettingsMap(files, allSql),
  ]);
  const edge = edgeChecked(FUNCTIONS);

  return {
    database: KEYS.filter((k) => database.has(k)),
    edgeOnly: KEYS.filter((k) => !database.has(k) && edge.has(k)),
    interfaceOnly: KEYS.filter((k) => !database.has(k) && !edge.has(k)),
  };
}

describe("capability enforcement split", () => {
  const { database, edgeOnly, interfaceOnly } = split();

  it("accounts for every right in the registry exactly once", () => {
    expect(database.length + edgeOnly.length + interfaceOnly.length).toBe(CAPABILITY_DEFS.length);
    expect(new Set([...database, ...edgeOnly, ...interfaceOnly]).size).toBe(CAPABILITY_DEFS.length);
  });

  // The named set, not just its size: the published sentence describes what
  // these three rights DO ("reorder or archive the production catalog and edit
  // its scheduling"), so a different three would make the description false
  // while the count still read as correct.
  it("leaves exactly the production-catalog and scheduling rights to the interface", () => {
    expect(interfaceOnly).toEqual([
      "producer_can_archive_productions",
      "producer_can_reorder_productions",
      "producer_can_edit_scheduling",
    ]);
  });

  // Server-side but not "in the database". These are gated by requireCapability
  // in an edge function, which asks the is_capability_enabled RPC before it
  // acts — a check a caller reaching the table directly would not meet.
  it("keeps the edge-only set to the six rights with no database policy", () => {
    expect(edgeOnly).toEqual([
      "producer_can_invite",
      "producer_can_run_offer_engine",
      "producer_can_view_linked_accounts",
      "producer_can_generate_hire_orders",
      "producer_can_issue_hire_orders",
      "producer_can_trigger_sync",
    ]);
  });

  // The sentence says "the row-level policy that guards the write OR the
  // function that performs it" because both shapes are in the 19. This pins
  // the one that is not a policy, so the clause cannot be quietly simplified
  // back to "a database policy" and become false again.
  it("counts the one right gated inside a security-definer function, not a policy", () => {
    const site = /is_capability_enabled\s*\([^;']*?'producer_can_rename_org'\s*\)/;
    const owners = migrationFiles().filter((f) => site.test(readFileSync(join(MIGRATIONS, f), "utf8")));
    expect(owners).toEqual(["20260723191933_rpc_capability_gates.sql"]);

    const sql = readFileSync(join(MIGRATIONS, owners[0]), "utf8");
    expect(sql).toMatch(/create or replace function public\.rename_org/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(database).toContain("producer_can_rename_org");
  });

  // The published sentence, number by number. This is the assertion that stops
  // the Trust Center printing a stale split on either surface.
  it("keeps the published carve-out sentence in step with the split", () => {
    const serverSide = database.length + edgeOnly.length;

    expect(CAPABILITY_INTERFACE_ONLY_NOTE).toContain(
      `${serverSide} of the ${CAPABILITY_DEFS.length} rights are checked on the server`,
    );
    // "inside the database", not "by a database policy": 18 of the 19 are an
    // is_capability_enabled call in a row-level policy, and rename_org is the
    // same call inside the SECURITY DEFINER function that performs the write.
    // The derivation above counts both shapes, so the sentence names both.
    expect(CAPABILITY_INTERFACE_ONLY_NOTE).toContain(`${database.length} inside the database`);
    expect(CAPABILITY_INTERFACE_ONLY_NOTE).toContain(`${edgeOnly.length} more by an edge function`);
    expect(CAPABILITY_INTERFACE_ONLY_NOTE).toContain("The remaining three");
    expect(interfaceOnly).toHaveLength(3);
  });

  // The Roles-and-rights card used to interpolate the whole sentence above,
  // all 58 words of it, which made it the longest claim on the page by 34
  // words. It now restates the load-bearing half — the server / interface
  // split — in its own words, and the full sentence renders on the
  // capabilities card. That restatement is a second hand-typed copy of the
  // same two numbers, so it needs the same gate: without this, closing one of
  // the three interface-only gaps would leave "25 ... three" published on both
  // surfaces with the note beside it corrected and CI green.
  it("keeps the Roles and rights claim's split in step with the same derivation", () => {
    const control = CONTROLS.find((c) => c.title === "Roles and rights");
    expect(control, "CONTROLS has no 'Roles and rights' entry").toBeDefined();

    const serverSide = database.length + edgeOnly.length;
    expect(control!.claim).toContain(`${serverSide} are checked on the server`);
    expect(control!.claim).toContain("three only by the interface");
    // The evidence line carries the breakdown the claim no longer has room for.
    expect(control!.evidence).toContain(`${database.length} sit inside the database`);
    expect(control!.evidence).toContain(`${edgeOnly.length} in an edge function`);
  });

  // The claim used to say nine sensitive rights "ask for a second
  // confirmation". Sitting next to the word "sensitive", that reads as
  // step-up confirmation AT USE TIME — a producer clicking Issue meets an
  // extra prompt. There is no such step anywhere. The confirmation guards an
  // ADMINISTRATOR changing the grant in Settings > Roles and permissions, and
  // it does not apply to the platform-default path at all. Pinned to the file
  // that implements it so the sentence cannot drift back to describing the
  // wrong actor.
  it("describes the sensitive-right confirmation as the grant change it actually is", () => {
    const source = readFileSync(
      resolve(ROOT, "src/components/settings/permissions/PermissionsMatrix.tsx"),
      "utf8",
    );
    // The gate: a sensitive key routes the ORG-MODE override through a pending
    // state instead of writing, and the pending state opens an AlertDialog.
    expect(source).toMatch(/risk === "sensitive"/);
    expect(source).toMatch(/setPending\(\{\s*cell,\s*enabled\s*\}\)/);
    expect(source).toMatch(/<AlertDialog\b/);
    // …and it is on `onToggleOverride` only. `onSetPlatformDefault` writes
    // straight through, which is the other reason "a second confirmation" was
    // too broad a description of what exists.
    expect(source).toMatch(/onSetPlatformDefault=\{\(enabled\) => writePolicy\.mutate/);

    const control = CONTROLS.find((c) => c.title === "Roles and rights");
    expect(control!.claim).toMatch(/changing one asks an administrator to confirm/i);
    expect(
      control!.claim,
      "'ask for a second confirmation' reads as step-up confirmation at use time",
    ).not.toMatch(/second confirmation/i);
  });
});
