#!/usr/bin/env node
// Emits public/trust.json — the published contract the landing page's
// /trust route reads (the same mechanism public/changelog.json already uses
// for /changelog; see vercel.json for the CORS headers).
//
// The app renders the Trust Center from src/lib/trust/* directly. The landing
// page is a separate repo and cannot import them, so it fetches this file. One
// source of truth, two consumers, and no hand-copied claim tables.
//
//   node scripts/build-trust-json.mjs           regenerate
//   node scripts/build-trust-json.mjs --check   fail if the committed file is stale
//
// Wired into `npm run sync:mirrors` / `sync:mirrors:check`, so the existing CI
// drift gate covers it: add a capability without regenerating and CI goes red.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/trust.json");

/** Load a dependency-free TS module by transpiling it and importing the result.
 *  Both source modules are deliberately import-free (no "@/" aliases), which is
 *  what lets this stay a ~10-line loader instead of a bundler configuration. */
async function loadModule(relPath) {
  const source = readFileSync(resolve(ROOT, relPath), "utf8");
  if (/^\s*import\s/m.test(source)) {
    throw new Error(
      `${relPath} has grown an import. This loader only handles dependency-free modules — ` +
        `either drop the import or switch this script to a real bundle step.`,
    );
  }
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const facts = await loadModule("src/lib/trust/facts.ts");
const { CAPABILITY_DEFS } = await loadModule("src/lib/capabilities.ts");

// Mirrors buildCapabilityInventory() in src/lib/trust/capabilityInventory.ts.
// That module imports capabilities.ts via the "@/" alias, so it cannot be
// loaded here; capabilityInventory.test.ts pins the numbers both sides print.
const groups = [];
for (const def of CAPABILITY_DEFS) {
  let group = groups.find((g) => g.group === def.group);
  if (!group) {
    group = { group: def.group, entries: [], sensitiveCount: 0 };
    groups.push(group);
  }
  const sensitive = def.risk === "sensitive";
  if (sensitive) group.sensitiveCount += 1;
  group.entries.push({
    label: def.label,
    description: def.description,
    sensitive,
    defaultEnabled: def.defaultEnabled,
    defaultLabel: def.defaultEnabled ? "On by default" : "Off by default",
  });
}
for (const group of groups) {
  group.countLabel = group.sensitiveCount
    ? `${group.entries.length} · ${group.sensitiveCount} sensitive`
    : String(group.entries.length);
}

const totalSensitive = CAPABILITY_DEFS.filter((d) => d.risk === "sensitive").length;
const totalDefaultOff = CAPABILITY_DEFS.filter((d) => !d.defaultEnabled).length;

if (!/^\d{4}-\d{2}-\d{2}$/.test(facts.FACTS_LAST_REVIEWED ?? "")) {
  throw new Error(
    "src/lib/trust/facts.ts must export FACTS_LAST_REVIEWED as a YYYY-MM-DD string.",
  );
}

const payload = {
  schema: 1,
  // A hand-bumped date living in facts.ts, not git history or Date.now() —
  // see FACTS_LAST_REVIEWED's doc comment for why.
  generatedAt: facts.FACTS_LAST_REVIEWED,
  roles: facts.TRUST_ROLES,
  kpis: facts.TRUST_KPIS,
  controls: facts.CONTROLS,
  matrix: facts.VISIBILITY_MATRIX,
  subprocessors: facts.SUBPROCESSORS,
  transferBasisNote: facts.TRANSFER_BASIS_NOTE,
  retention: facts.RETENTION,
  selfServeRights: facts.SELF_SERVE_RIGHTS,
  documents: facts.DOCUMENTS,
  documentsNote: facts.DOCUMENTS_NOTE,
  contact: facts.TRUST_CONTACT,
  capabilities: {
    groups,
    totalRights: CAPABILITY_DEFS.length,
    totalGroups: groups.length,
    totalSensitive,
    totalDefaultOff,
    headline: `${CAPABILITY_DEFS.length} rights · ${groups.length} groups · ${totalSensitive} sensitive`,
    // The interface-only carve-out travels in the contract rather than being
    // retyped in the landing repo, where no drift gate can see it. See
    // CAPABILITY_INTERFACE_ONLY_NOTE in src/lib/trust/facts.ts.
    note: facts.CAPABILITY_INTERFACE_ONLY_NOTE,
  },
};

if (typeof payload.capabilities.note !== "string" || !payload.capabilities.note) {
  throw new Error(
    "src/lib/trust/facts.ts must export CAPABILITY_INTERFACE_ONLY_NOTE as a non-empty string.",
  );
}

const serialized = `${JSON.stringify(payload, null, 2)}\n`;

let committedRaw = null;
try {
  committedRaw = readFileSync(OUT, "utf8");
} catch {
  committedRaw = null;
}

// Staleness gate: FACTS_LAST_REVIEWED is a hand-bumped promise that the
// claims were checked as of that date. Nothing previously forced it to move
// when a claim actually changed, so a regenerate could carry new claims
// forward under an old, no-longer-accurate date with every other check still
// green (see the FACTS_LAST_REVIEWED finding). Catch that here: if the
// payload differs from what is committed anywhere other than the stamp
// itself, the stamp must equal today, or this refuses to proceed. This does
// not touch how the stamp is produced (still a hand-bumped literal in
// facts.ts, not derived from git or Date.now(), for the reasons documented
// on FACTS_LAST_REVIEWED) — it only validates that a same-day bump happened.
if (committedRaw !== null) {
  try {
    const withoutStamp = (p) => {
      const { generatedAt, ...rest } = p;
      return JSON.stringify(rest);
    };
    const committed = JSON.parse(committedRaw);
    const contentChanged = withoutStamp(committed) !== withoutStamp(payload);
    const today = new Date().toISOString().slice(0, 10);
    if (contentChanged && facts.FACTS_LAST_REVIEWED !== today) {
      console.error(
        `A trust.json claim changed but FACTS_LAST_REVIEWED (${facts.FACTS_LAST_REVIEWED}) is not today (${today}).\n` +
          "Bump FACTS_LAST_REVIEWED in src/lib/trust/facts.ts to today's date, then regenerate.",
      );
      process.exit(1);
    }
  } catch {
    // Malformed committed file: fall through to the checks below, which
    // handle a missing/garbled public/trust.json on their own.
  }
}

if (process.argv.includes("--check")) {
  if (committedRaw === null) {
    console.error("public/trust.json is missing. Run `npm run sync:mirrors`.");
    process.exit(1);
  }
  if (committedRaw !== serialized) {
    console.error(
      "public/trust.json is stale — src/lib/trust/facts.ts or the capability registry changed.\n" +
        "Run `npm run sync:mirrors` and commit the result.",
    );
    process.exit(1);
  }
  console.log("public/trust.json up to date");
} else {
  writeFileSync(OUT, serialized);
  console.log(
    `public/trust.json written (${CAPABILITY_DEFS.length} rights, ${facts.VISIBILITY_MATRIX.length} matrix rows)`,
  );
}
