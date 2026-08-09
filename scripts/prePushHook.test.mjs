// Guards the committed pre-push hook and the `prepare` script that installs it.
//
// The hook runs `verify:fast` (the Docker-free CI mirror: lint, mirrors,
// typecheck, build, unit+coverage, Deno) before every push, so the cheap layers
// fail on the developer's machine instead of burning a red GitHub CI run. It is
// a convenience gate, NOT the source of truth — GitHub CI stays the enforced
// gate and runs on the merged commit regardless.
//
// Three things a future edit could silently break, each guarded below:
//   1. The hook must be tracked AND recorded executable in the index — a 100644
//      blob is checked out non-executable, and git then silently skips it, so a
//      clone/CI checkout would install a dead hook.
//   2. `verify:full` (pgTAP + Playwright, Docker) must NOT be wired here — a
//      container cold-start on every push just trains everyone to --no-verify.
//   3. `prepare` must point git at `.githooks`, else the hook is never installed.
//
// Runs in the vitest suite via the `scripts/**/*.test.{ts,mjs}` include glob, so
// a regression fails CI's unit-tests job.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hookRel = ".githooks/pre-push";
const hookPath = join(repoRoot, hookRel);

/** The mode git has recorded for `relPath` in the index (e.g. "100755"), or null. */
function gitIndexMode(relPath) {
  try {
    // `git ls-files -s` prints e.g. "100755 <sha> 0\t.githooks/pre-push".
    const out = execFileSync("git", ["ls-files", "-s", "--", relPath], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return out ? out.split(/\s+/)[0] : null;
  } catch {
    return null;
  }
}

describe("pre-push hook (.githooks/pre-push)", () => {
  it("exists on disk", () => {
    expect(existsSync(hookPath)).toBe(true);
  });

  it("is tracked and recorded executable (survives a clean checkout)", () => {
    // 100755, not 100644 — otherwise git checks it out non-executable and
    // silently declines to run it.
    expect(gitIndexMode(hookRel)).toBe("100755");
  });

  it("runs the Docker-free verify:fast layer, never the Docker-gated full run", () => {
    const body = readFileSync(hookPath, "utf8");
    // Inspect only executable lines: comments legitimately mention verify:full
    // to explain why the Docker tier is intentionally NOT run here.
    const code = body
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).toMatch(/verify:fast|verify\.sh --fast/);
    expect(code).not.toMatch(/verify:full|verify\.sh --full/);
  });

  it("scans for committed secrets AND aborts the push when any are found", () => {
    const code = readFileSync(hookPath, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    // The scan must both run and STOP the push on a hit. The hook uses
    // `set -uo pipefail` (no `-e`), so without an explicit `|| exit` a failing
    // scan (exit 1) falls through to verify:fast and the hook exits with
    // verify:fast's code — silently pushing the secret. Assert the guard, not
    // just the string. (Guards the review finding on PR #229.) Matches either
    // the npm alias (`scan:secrets`) or the direct `scan-secrets.mjs --prepush`.
    expect(code).toMatch(/scan[:-]secrets\b[^\n]*\|\|\s*exit\b/);
  });
});

describe("prepare script installs the hook path", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  it("points git core.hooksPath at .githooks", () => {
    expect(pkg.scripts?.prepare).toBeDefined();
    expect(pkg.scripts.prepare).toContain("core.hooksPath");
    expect(pkg.scripts.prepare).toContain(".githooks");
  });
});
