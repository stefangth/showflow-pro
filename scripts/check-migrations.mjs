// Detect repo migrations not yet applied to production. Name-based (drift-tolerant):
// production's recorded versions drift from repo filenames by seconds, but names
// are preserved. See docs/superpowers/specs/2026-07-24-*.md, Feature C.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** `<version>_<name>.sql` -> `<name>`. */
export function repoNameFromFilename(filename) {
  return filename.replace(/^[0-9]+_/, "").replace(/\.sql$/, "");
}

/** Repo migration names absent from the applied-name set, in order. */
export function diffMigrations(repoNames, appliedNames) {
  return repoNames.filter((n) => !appliedNames.has(n));
}

/** Applied migration names in production, via the Supabase Management API. */
async function fetchAppliedNames(ref, token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select name from supabase_migrations.schema_migrations" }),
  });
  if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return new Set(rows.map((r) => r.name).filter((n) => typeof n === "string" && n.length > 0));
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || "epweartpzwvcasrzyueh";
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is required");
    process.exit(2);
  }

  const migDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const repoNames = readdirSync(migDir).filter((f) => f.endsWith(".sql")).map(repoNameFromFilename);
  const applied = await fetchAppliedNames(ref, token);
  const missing = diffMigrations(repoNames, applied);

  if (missing.length > 0) {
    console.error(`::error::${missing.length} migration(s) merged but NOT applied to production:`);
    for (const n of missing) console.error(`  - ${n}`);
    console.error("Apply them (Supabase MCP apply_migration or supabase db push), then re-run.");
    process.exit(1);
  }
  console.log(`All ${repoNames.length} repo migrations are applied to production.`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
