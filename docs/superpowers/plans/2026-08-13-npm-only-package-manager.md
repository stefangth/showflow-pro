# npm-only Package Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make npm the sole supported package manager for root Node dependencies and prevent alternative root lockfiles from returning.

**Architecture:** A focused Node policy module scans only the repository root for unsupported lockfiles and exposes a testable function plus a CLI exit code. npm metadata, local verification, and CI all invoke that policy; obsolete Bun state and instructions are removed. Deno lockfiles remain untouched because they belong to the Supabase Edge runtime.

**Tech Stack:** Node.js ESM, Vitest, npm, Bash, GitHub Actions YAML

## Global Constraints

- `package-lock.json` remains the only root Node dependency lockfile.
- Reject root `bun.lock`, `bun.lockb`, `yarn.lock`, and `pnpm-lock.yaml` files.
- Do not reject nested Deno lockfiles or change any `deno.lock` file.
- CI continues installing dependencies with `npm ci` on Node 22.
- Follow strict red-green TDD for the policy module.

---

## File structure

- Create `scripts/check-package-manager.mjs`: root-lockfile policy API and CLI.
- Create `scripts/check-package-manager.test.mjs`: isolated filesystem behavior tests.
- Modify `package.json`: declare npm and expose `check:package-manager`.
- Modify `scripts/verify.sh`: run the policy at the start of the fast verification layers.
- Modify `.github/workflows/ci.yml`: enforce the policy before `npm ci` in the lint job.
- Delete `bun.lock`: remove the unsupported duplicate Node dependency graph.
- Delete `docs/runbooks/bun-lock-registry-migration.md`: remove obsolete instructions that recreate the deleted lockfile.

### Task 1: Package-manager policy module

**Files:**
- Create: `scripts/check-package-manager.test.mjs`
- Create: `scripts/check-package-manager.mjs`

**Interfaces:**
- Produces: `UNSUPPORTED_ROOT_LOCKFILES`, a frozen array containing `bun.lock`, `bun.lockb`, `yarn.lock`, and `pnpm-lock.yaml`.
- Produces: `findUnsupportedRootLockfiles(rootDir: string): string[]`, returning present unsupported filenames in declared order.
- Produces: `runPackageManagerCheck(rootDir: string, io?: { out(message: string): void; error(message: string): void }): number`, returning `0` on success and `1` after reporting unsupported files.
- CLI: `node scripts/check-package-manager.mjs` checks the repository root derived from the script location and exits with the returned status.

- [ ] **Step 1: Write the failing behavior tests**

Create `scripts/check-package-manager.test.mjs`:

```js
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findUnsupportedRootLockfiles,
  runPackageManagerCheck,
} from "./check-package-manager.mjs";

const roots = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "showflow-package-manager-"));
  roots.push(root);
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("root package-manager policy", () => {
  it("accepts package-lock.json and ignores nested runtime lockfiles", () => {
    const root = makeRoot();
    const functionDir = join(root, "supabase", "functions", "example");
    mkdirSync(functionDir, { recursive: true });
    writeFileSync(join(functionDir, "bun.lock"), "\n");
    writeFileSync(join(functionDir, "deno.lock"), "{}\n");
    expect(findUnsupportedRootLockfiles(root)).toEqual([]);
  });

  it.each(["bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"])(
    "rejects root %s",
    (filename) => {
      const root = makeRoot();
      writeFileSync(join(root, filename), "\n");
      expect(findUnsupportedRootLockfiles(root)).toEqual([filename]);
    },
  );

  it("reports every unsupported lockfile and returns a failing status", () => {
    const root = makeRoot();
    writeFileSync(join(root, "bun.lock"), "\n");
    writeFileSync(join(root, "yarn.lock"), "\n");
    const errors = [];

    expect(
      runPackageManagerCheck(root, {
        out: () => {},
        error: (message) => errors.push(message),
      }),
    ).toBe(1);
    expect(errors.join("\n")).toContain("bun.lock");
    expect(errors.join("\n")).toContain("yarn.lock");
    expect(errors.join("\n")).toContain("npm install");
  });
});
```

Production mutations caught: omitting any prohibited filename, scanning a path other than the supplied root, or returning success when a prohibited lockfile exists.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run scripts/check-package-manager.test.mjs
```

Expected: FAIL because `scripts/check-package-manager.mjs` does not exist.

- [ ] **Step 3: Implement the minimal policy module and CLI**

Create `scripts/check-package-manager.mjs`:

```js
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UNSUPPORTED_ROOT_LOCKFILES = Object.freeze([
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

export function findUnsupportedRootLockfiles(rootDir) {
  return UNSUPPORTED_ROOT_LOCKFILES.filter((filename) =>
    existsSync(join(rootDir, filename)),
  );
}

export function runPackageManagerCheck(
  rootDir,
  io = { out: console.log, error: console.error },
) {
  const unsupported = findUnsupportedRootLockfiles(rootDir);
  if (unsupported.length === 0) {
    io.out("package-manager policy: npm lockfile only");
    return 0;
  }

  io.error(
    `Unsupported root lockfile(s): ${unsupported.join(", ")}. ` +
      "Use npm install for dependency changes and commit package-lock.json.",
  );
  return 1;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = join(dirname(scriptPath), "..");
  process.exitCode = runPackageManagerCheck(repoRoot);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run scripts/check-package-manager.test.mjs
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit the tested policy module**

```bash
git add scripts/check-package-manager.mjs scripts/check-package-manager.test.mjs
git commit -m "test: enforce npm-only root lockfiles"
```

### Task 2: Wire enforcement and remove Bun state

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify.sh`
- Modify: `.github/workflows/ci.yml`
- Delete: `bun.lock`
- Delete: `docs/runbooks/bun-lock-registry-migration.md`

**Interfaces:**
- Consumes: `node scripts/check-package-manager.mjs`, implemented in Task 1.
- Produces: npm script `check:package-manager`.
- Produces: CI and local fast-verification failure before other project gates when an unsupported root lockfile exists.

- [ ] **Step 1: Declare npm and add the policy command**

Add the top-level field after `version` in `package.json`:

```json
"packageManager": "npm@11.19.0",
```

Add this script before `sync:mirrors`:

```json
"check:package-manager": "node scripts/check-package-manager.mjs",
```

Do not run `npm install`; neither change alters dependencies, so `package-lock.json` must remain byte-for-byte unchanged.

- [ ] **Step 2: Put the policy first in local fast verification**

In `scripts/verify.sh`, add this as the first Docker-free layer:

```bash
run "package-manager"  npm run --silent check:package-manager
```

- [ ] **Step 3: Put the policy before dependency installation in CI**

In the `lint` job of `.github/workflows/ci.yml`, after `actions/setup-node@v7` and before `npm ci`, add:

```yaml
      - name: Enforce npm-only root lockfile
        run: node scripts/check-package-manager.mjs
```

One CI job is sufficient because the policy evaluates committed repository state, which is identical across jobs.

- [ ] **Step 4: Delete obsolete Bun artifacts**

Delete:

```text
bun.lock
docs/runbooks/bun-lock-registry-migration.md
```

Keep every `deno.lock` file.

- [ ] **Step 5: Run policy and focused tests**

Run:

```bash
npm run check:package-manager
npx vitest run scripts/check-package-manager.test.mjs
```

Expected: policy exits 0 and all 6 focused tests pass.

- [ ] **Step 6: Verify metadata and cleanup invariants**

Run:

```bash
node -e 'const p=require("./package.json"); if(p.packageManager!=="npm@11.19.0"||p.scripts["check:package-manager"]!=="node scripts/check-package-manager.mjs") process.exit(1)'
test -f package-lock.json
test ! -e bun.lock
test ! -e bun.lockb
test ! -e yarn.lock
test ! -e pnpm-lock.yaml
git diff --exit-code -- package-lock.json
```

Expected: every command exits 0; `package-lock.json` is unchanged.

- [ ] **Step 7: Commit wiring and cleanup**

```bash
git add package.json scripts/verify.sh .github/workflows/ci.yml bun.lock docs/runbooks/bun-lock-registry-migration.md
git commit -m "chore: standardize Node dependencies on npm"
```

### Task 3: Full verification

**Files:**
- Verify only; no planned modifications.

**Interfaces:**
- Consumes: npm-only policy and all existing repository verification commands.
- Produces: fresh evidence that the policy and existing application gates pass together.

- [ ] **Step 1: Run formatting and repository scans**

```bash
git diff --check HEAD~2..HEAD
rg -n -i "npm install\s+# or bun install|bun install" CLAUDE.md package.json scripts .github || true
find . -maxdepth 1 -type f \( -name 'bun.lock' -o -name 'bun.lockb' -o -name 'yarn.lock' -o -name 'pnpm-lock.yaml' \) -print
```

Expected: `git diff --check` exits 0 and both scans print nothing.

- [ ] **Step 2: Run the complete Docker-free verification suite**

```bash
npm run verify:fast
```

Expected: exit 0 with PASS for package-manager, mirrors, lint, app/tool typechecks, build, unit+coverage, Deno check, and Deno tests.

- [ ] **Step 3: Inspect final scope**

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree; commits are limited to the approved design/docs, policy module/tests, npm wiring, and obsolete Bun-file removals.
