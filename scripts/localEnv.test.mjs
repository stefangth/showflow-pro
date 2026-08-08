// Guards the committed local-dev default (.env.development) — the mechanism that
// makes `npm run dev` and the local test stack target the LOCAL database instead
// of production.
//
// Two invariants, both of which a future edit could silently break:
//   1. The committed default is tracked, and its per-run twin
//      (.env.development.local, which holds the live service-role key) is NOT.
//   2. The committed default points at 127.0.0.1 and carries no production
//      reference — so this default can never quietly become prod.
//
// Runs in the vitest suite via the `scripts/**/*.test.{ts,mjs}` include glob, so
// a regression fails CI's unit-tests job.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_PROJECT_REF = "epweartpzwvcasrzyueh";

/** True if git's ignore rules would ignore `relPath`. */
function isGitIgnored(relPath) {
  try {
    // `git check-ignore` exits 0 when the path IS ignored, 1 when it is not.
    execFileSync("git", ["check-ignore", "-q", "--", relPath], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

describe("committed local-dev env default (.env.development)", () => {
  const envPath = join(repoRoot, ".env.development");

  it("exists and is committed (not gitignored)", () => {
    expect(existsSync(envPath)).toBe(true);
    expect(isGitIgnored(".env.development")).toBe(false);
  });

  it("keeps the per-run local override gitignored (it holds the service-role key)", () => {
    expect(isGitIgnored(".env.development.local")).toBe(true);
  });

  it("targets the local stack, never production", () => {
    const body = readFileSync(envPath, "utf8");
    const url = body
      .split("\n")
      .find((l) => l.startsWith("VITE_SUPABASE_URL="))
      ?.slice("VITE_SUPABASE_URL=".length)
      .trim();

    expect(url).toBeDefined();
    expect(url).toContain("127.0.0.1");
    expect(body).not.toContain(PROD_PROJECT_REF);
    expect(body).not.toContain(".supabase.co");
  });
});
