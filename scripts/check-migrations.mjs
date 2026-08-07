// Compare the repo's migrations against the ones recorded in production.
//
// Four failures matter, and they are different problems:
//
//   mismatched — same migration name on both sides under DIFFERENT versions.
//                `supabase db push` aborts WHOLESALE on this ("Remote migration
//                versions not found in local migrations directory") and applies
//                nothing, so a single drifted row silently disables every
//                subsequent deploy. This is what happened from 2026-07-23.
//   duplicated — production recorded the same name twice under two versions.
//                Ambiguous, and the same shape of incident as a mismatch.
//   orphaned   — production recorded a migration the repo has no file for.
//   missing    — a repo migration is not applied. Code can ship against a schema
//                that does not exist (this broke multi-date hire orders on
//                2026-07-24).
//
// The mismatch check is why this script no longer compares by name alone: name
// is exactly the property that drift preserves, so a name-only check stayed
// green through two weeks of failed production deploys.
//
// `missing` is the only one that is TIMING-DEPENDENT, and both its callers have
// to account for that:
//
//   --allow-missing    PR runs. A migration the PR adds cannot be in production
//                      yet, because the MERGE is what applies it. Enforcing
//                      `missing` pre-merge would fail every migration-bearing PR
//                      by construction. Drift and orphans are still enforced.
//   --wait-seconds=N   Post-merge runs. The Supabase deploy workflow applies
//                      migrations asynchronously (its health step alone waits up
//                      to 2 minutes), so a check that fires seconds after the
//                      push can read production before the apply lands. Poll for
//                      up to N seconds before calling a migration missing. Only
//                      `missing` is retried; drift never resolves itself.
//
// Detect-only — never applies anything.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const POLL_INTERVAL_MS = 15_000;

/** `<version>_<name>.sql` -> `{version, name}`. */
export function parseMigrationFilename(filename) {
  const match = /^(\d+)_(.+)\.sql$/.exec(filename);
  if (!match) throw new Error(`Unrecognised migration filename: ${filename}`);
  return { version: match[1], name: match[2] };
}

/**
 * Management API rows -> `{version, name}[]`.
 *
 * Throws rather than skipping a row it cannot read. Silently dropping one makes
 * its repo counterpart look `missing` (and prints the wrong remediation), or
 * makes a genuine orphan vanish so the check passes on a database `db push` will
 * still refuse. Better to fail on a surprise than to compare a truncated set.
 */
export function parseAppliedRows(rows) {
  return rows.map((row, index) => {
    const version = row?.version;
    const name = row?.name;
    if (typeof version !== "string" || typeof name !== "string" || name.length === 0) {
      throw new Error(
        `Unusable row ${index} from schema_migrations: ${JSON.stringify(row)}. ` +
          `Refusing to compare against a truncated set.`
      );
    }
    return { version, name };
  });
}

/** `["--allow-missing", "--wait-seconds=300"]` -> `{allowMissing, waitSeconds}`. */
export function parseCliOptions(argv) {
  const options = { allowMissing: false, waitSeconds: 0 };
  for (const arg of argv) {
    if (arg === "--allow-missing") {
      options.allowMissing = true;
      continue;
    }
    const wait = /^--wait-seconds=(.*)$/.exec(arg);
    if (wait) {
      const seconds = Number(wait[1]);
      if (!Number.isInteger(seconds) || seconds < 0) {
        throw new Error(`--wait-seconds needs a non-negative integer, got "${wait[1]}"`);
      }
      options.waitSeconds = seconds;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

/**
 * Name is the join key between the repo and production, because it is the only
 * field that survives an out-of-band apply. A repo-side duplicate is a repo bug
 * the author can fix, so it throws; a production-side duplicate is a real state
 * the operator has to be told about, so it is reported.
 */
function indexRepoByName(migrations) {
  const byName = new Map();
  for (const migration of migrations) {
    if (byName.has(migration.name)) {
      throw new Error(`Duplicate migration name in the repo set: ${migration.name}`);
    }
    byName.set(migration.name, migration);
  }
  return byName;
}

/**
 * @param {{version: string, name: string}[]} repoMigrations
 * @param {{version: string, name: string}[]} appliedMigrations
 * @returns {{missing: object[], orphaned: object[], mismatched: object[], duplicated: object[]}}
 */
export function compareMigrations(repoMigrations, appliedMigrations) {
  const repoByName = indexRepoByName(repoMigrations);

  const appliedByName = new Map();
  const duplicateNames = new Set();
  for (const migration of appliedMigrations) {
    const seen = appliedByName.get(migration.name);
    if (seen) {
      seen.push(migration);
      duplicateNames.add(migration.name);
    } else {
      appliedByName.set(migration.name, [migration]);
    }
  }

  const duplicated = [...duplicateNames].map((name) => ({
    name,
    versions: appliedByName.get(name).map((migration) => migration.version),
  }));

  const missing = [];
  const mismatched = [];
  for (const migration of repoMigrations) {
    // A duplicated name has no single applied version to compare against, and is
    // already reported under `duplicated`.
    if (duplicateNames.has(migration.name)) continue;
    const applied = appliedByName.get(migration.name)?.[0];
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

  return { missing, orphaned, mismatched, duplicated };
}

/** Categories that should fail the run, most severe first. */
export function blockingFailures(result, { allowMissing }) {
  return ["mismatched", "duplicated", "orphaned", "missing"].filter((category) => {
    if (category === "missing" && allowMissing) return false;
    return (result[category] ?? []).length > 0;
  });
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
    return parseAppliedRows(await res.json());
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Management API query timed out after 30s");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reportMismatched(mismatched) {
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

function reportDuplicated(duplicated) {
  console.error(`::error::${duplicated.length} migration name(s) recorded MORE THAN ONCE in production:`);
  for (const d of duplicated) console.error(`  - ${d.name}: versions ${d.versions.join(", ")}`);
  console.error("  Drop the row that should not be there with `supabase migration repair <version> --status reverted`.");
}

function reportOrphaned(orphaned) {
  console.error(`::error::${orphaned.length} migration(s) applied to production have no file in the repo:`);
  for (const m of orphaned) console.error(`  - ${m.version}_${m.name}`);
  console.error("  Commit the missing file, or mark the row reverted with `supabase migration repair`.");
}

function reportMissing(missing, { blocking }) {
  const prefix = blocking ? "::error::" : "::warning::";
  console.error(`${prefix}${missing.length} migration(s) in the repo are not applied to production:`);
  for (const m of missing) console.error(`  - ${m.version}_${m.name}`);
  if (blocking) {
    console.error("  Apply them (Supabase MCP apply_migration or supabase db push), then re-run.");
    console.error("  If you apply by hand, rename the file to the version that gets recorded.");
  } else {
    console.error("  Expected before the merge: the merge is what applies them. Not failing the run.");
  }
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || process.env.PROJECT_REF || "epweartpzwvcasrzyueh";
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is required");
    process.exit(2);
  }

  const migDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const repoMigrations = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => parseMigrationFilename(f));

  // Poll only while `missing` is the sole blocker: the production apply is
  // asynchronous, so a migration can still be in flight. Drift, duplicates and
  // orphans never resolve on their own, so those fail on the first read.
  const deadline = Date.now() + options.waitSeconds * 1000;
  let result;
  let blocking;
  for (;;) {
    result = compareMigrations(repoMigrations, await fetchAppliedMigrations(ref, token));
    blocking = blockingFailures(result, options);
    const waitingOnApply = blocking.length === 1 && blocking[0] === "missing";
    if (!waitingOnApply || Date.now() >= deadline) break;
    console.log(
      `${result.missing.length} migration(s) not applied yet; the production apply is asynchronous. ` +
        `Re-checking in ${POLL_INTERVAL_MS / 1000}s.`
    );
    await sleep(POLL_INTERVAL_MS);
  }

  if (result.mismatched.length > 0) reportMismatched(result.mismatched);
  if (result.duplicated.length > 0) reportDuplicated(result.duplicated);
  if (result.orphaned.length > 0) reportOrphaned(result.orphaned);
  if (result.missing.length > 0) reportMissing(result.missing, { blocking: !options.allowMissing });

  if (blocking.length > 0) process.exit(1);

  console.log(`All ${repoMigrations.length} repo migrations are applied to production at matching versions.`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
