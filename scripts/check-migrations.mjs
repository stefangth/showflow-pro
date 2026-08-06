// Compare the repo's migrations against the ones recorded in production.
//
// Three failures matter, and they are different problems:
//
//   missing    — a repo migration was never applied. Code can ship against a
//                schema that does not exist (this broke multi-date hire orders
//                on 2026-07-24).
//   orphaned   — production recorded a migration the repo has no file for.
//   mismatched — same migration name on both sides under DIFFERENT versions.
//                `supabase db push` aborts WHOLESALE on this ("Remote migration
//                versions not found in local migrations directory") and applies
//                nothing, so a single drifted row silently disables every
//                subsequent deploy. This is what happened from 2026-07-23.
//
// The mismatch check is why this script no longer compares by name alone: name
// is exactly the property that drift preserves, so a name-only check stayed
// green through two weeks of failed production deploys.
//
// Detect-only — never applies anything.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** `<version>_<name>.sql` -> `{version, name}`. */
export function parseMigrationFilename(filename) {
  const match = /^(\d+)_(.+)\.sql$/.exec(filename);
  if (!match) throw new Error(`Unrecognised migration filename: ${filename}`);
  return { version: match[1], name: match[2] };
}

/**
 * Name is the join key between the repo and production, because it is the only
 * field that survives an out-of-band apply. A duplicate makes every comparison
 * ambiguous, so fail loudly rather than silently picking one.
 */
function indexByName(migrations, side) {
  const byName = new Map();
  for (const migration of migrations) {
    if (byName.has(migration.name)) {
      throw new Error(`Duplicate migration name in the ${side} set: ${migration.name}`);
    }
    byName.set(migration.name, migration);
  }
  return byName;
}

/**
 * @param {{version: string, name: string}[]} repoMigrations
 * @param {{version: string, name: string}[]} appliedMigrations
 * @returns {{missing: object[], orphaned: object[], mismatched: object[]}}
 */
export function compareMigrations(repoMigrations, appliedMigrations) {
  const repoByName = indexByName(repoMigrations, "repo");
  const appliedByName = indexByName(appliedMigrations, "applied");

  const missing = [];
  const mismatched = [];
  for (const migration of repoMigrations) {
    const applied = appliedByName.get(migration.name);
    if (!applied) {
      missing.push(migration);
    } else if (applied.version !== migration.version) {
      mismatched.push({
        name: migration.name,
        repoVersion: migration.version,
        appliedVersion: applied.version,
      });
    }
  }
  const orphaned = appliedMigrations.filter((migration) => !repoByName.has(migration.name));

  return { missing, orphaned, mismatched };
}

/** Migrations recorded in production, via the Supabase Management API. */
async function fetchAppliedMigrations(ref, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "select version, name from supabase_migrations.schema_migrations" }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return rows
      .filter((r) => typeof r.name === "string" && r.name.length > 0 && typeof r.version === "string")
      .map((r) => ({ version: r.version, name: r.name }));
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Management API query timed out after 30s");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || "epweartpzwvcasrzyueh";
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is required");
    process.exit(2);
  }

  const migDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const repoMigrations = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map(parseMigrationFilename);
  const applied = await fetchAppliedMigrations(ref, token);
  const { missing, orphaned, mismatched } = compareMigrations(repoMigrations, applied);

  if (mismatched.length > 0) {
    console.error(
      `::error::${mismatched.length} migration(s) applied under a DIFFERENT version than their repo filename.`
    );
    console.error("  `supabase db push` aborts wholesale on this and applies NOTHING.");
    for (const m of mismatched) {
      console.error(`  - ${m.name}: repo ${m.repoVersion}, applied ${m.appliedVersion}`);
    }
    console.error("  Fix: rename each repo file to the applied version, keeping the name:");
    for (const m of mismatched) {
      console.error(
        `    git mv supabase/migrations/${m.repoVersion}_${m.name}.sql supabase/migrations/${m.appliedVersion}_${m.name}.sql`
      );
    }
    console.error("  Check first that the rename keeps the file in the same position relative to its neighbours.");
  }

  if (missing.length > 0) {
    console.error(`::error::${missing.length} migration(s) in the repo are NOT applied to production:`);
    for (const m of missing) console.error(`  - ${m.version}_${m.name}`);
    console.error("  Apply them (Supabase MCP apply_migration or supabase db push), then re-run.");
    console.error("  If you apply by hand, rename the file to the version that gets recorded.");
  }

  if (orphaned.length > 0) {
    console.error(`::error::${orphaned.length} migration(s) applied to production have no file in the repo:`);
    for (const m of orphaned) console.error(`  - ${m.version}_${m.name}`);
    console.error("  Commit the missing file, or mark the row reverted with `supabase migration repair`.");
  }

  if (mismatched.length + missing.length + orphaned.length > 0) process.exit(1);

  console.log(`All ${repoMigrations.length} repo migrations are applied to production at matching versions.`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
