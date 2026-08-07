// supabase/seed.sql runs on `supabase start`, which is what the pgTAP CI job boots
// before running supabase/tests/**. The seeded rows are therefore PRESENT for every
// pgTAP test, and any UUID the seed and a test fixture share becomes a duplicate-key
// error inside that test's transaction.
//
// That is not hypothetical: the first version of the seed took 22222222-…, 44444444-…
// and 77777777-… , which are fixture ids in bookings_artist_org_guard.sql and
// platform_audit_log.sql, and it broke the pgTAP job on push. The fixtures own the
// repeated-digit space, so the seed owns `5eed…` instead.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * The bootstrap org is a shared production constant created by migration
 * 20260603120100, not an id the seed owns. Both sides reference it and neither
 * inserts it, so it cannot collide.
 */
const SHARED_CONSTANTS = new Set([
  "00000000-0000-0000-0000-00000000b007",
  // GoTrue's single-instance sentinel for auth.users.instance_id.
  "00000000-0000-0000-0000-000000000000",
]);

function uuidsIn(text) {
  return new Set((text.match(UUID) ?? []).map((u) => u.toLowerCase()));
}

function sqlFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sqlFilesUnder(path);
    return entry.name.endsWith(".sql") ? [path] : [];
  });
}

describe("seed fixture isolation", () => {
  const seedUuids = uuidsIn(readFileSync(join(repoRoot, "supabase", "seed.sql"), "utf8"));

  const testUuids = new Map();
  for (const file of sqlFilesUnder(join(repoRoot, "supabase", "tests"))) {
    for (const uuid of uuidsIn(readFileSync(file, "utf8"))) {
      testUuids.set(uuid, [...(testUuids.get(uuid) ?? []), file]);
    }
  }

  it("shares no UUID with any pgTAP fixture", () => {
    const collisions = [...seedUuids]
      .filter((uuid) => !SHARED_CONSTANTS.has(uuid) && testUuids.has(uuid))
      .map((uuid) => `${uuid} (also in ${testUuids.get(uuid).length} pgTAP file(s))`);
    expect(collisions).toEqual([]);
  });

  it("keeps every seed-owned UUID in the 5eed namespace", () => {
    const strays = [...seedUuids].filter((uuid) => !SHARED_CONSTANTS.has(uuid) && !uuid.startsWith("5eed"));
    expect(strays).toEqual([]);
  });
});
