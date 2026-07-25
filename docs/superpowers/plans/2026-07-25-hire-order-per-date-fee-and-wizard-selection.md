# Hire Order Per-Date Fee + Wizard Date Pre-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a producer enter the engagement fee either per date or as a total for the whole engagement, summing correctly across an aggregate order's dates, and make the multi-date selection in the wizard's first step carry into the per-artist grid by default.

**Architecture:** The stored `fee` field stays the **total payable**, so every existing consumer (KPI rollups, the `missing_fee` readiness check, the edit page, the PDF total) is untouched. The wizard sends the entered amount plus a top-level `fee_basis`; the edge function multiplies by the artist's date count inside `draftBatchArtist`, **after** already-covered dates are dropped. Two new derived snapshot fields (`fee_basis`, `fee_per_date`) carry the breakdown so the PDF can print "500.00 per date x 3 dates" above the total.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Deno edge functions, `@react-pdf/renderer` v4.

**Spec:** `docs/superpowers/specs/2026-07-25-hire-order-pdf-template-editor-design.md` sections 6 and 7.

## Global Constraints

- **`any` is banned.** Lint runs `--max-warnings 0`. Where supabase-js can't infer a shape, define a local row `interface` and cast once with `as unknown as Row[]` right after the error check.
- **No em dashes or en dashes in any product copy** (UI strings, PDF copy defaults, changelog). Use a period, comma, or middot.
- **Dual-home discipline.** The Deno edge runtime cannot import from `src/`: the two sides use incompatible module specifier dialects (edge uses explicit `.ts` extensions and `npm:` specifiers, frontend uses the `@/` Vite alias and extensionless bare specifiers), and Supabase deploys only what is under `supabase/functions/`. Shared code is therefore duplicated across the two trees. **This duplication is mandated and is not a defect** — do not "fix" it by extracting a shared import; there is no import path that resolves in both runtimes.
- **Mirrors are GENERATED, not hand-copied** (Task 0). Edit the **source** file only, then run `npm run sync:mirrors`. Never hand-edit a generated target; `npm run sync:mirrors:check` fails CI if you do. Structural mirrors that the generator cannot cover (`src/lib/hireOrders/types.ts` against `supabase/functions/_shared/hireOrders.ts`, which combines five source files into one) remain hand-maintained: change both in the same commit.
- **Test-first.** Write the failing test, run it, watch it fail, then implement.
- **Money is never computed with floats.** Multiply in integer cents.
- **Tests import the real module.** Never re-implement production logic in a test.
- Run commands from the repo root: `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/booking-engine-ui-ux-09cbf4`.

### Command reference

| Purpose | Command |
|---|---|
| One vitest file | `npx vitest run <path>` |
| All vitest | `npx vitest run` |
| Edge function tests | `deno test --allow-all --node-modules-dir=none supabase/functions/` |
| One edge test file | `deno test --allow-all --node-modules-dir=none <path>` |
| Lint gate | `npm run lint` |

`--node-modules-dir=none` is required or the Deno suite picks up the frontend's `node_modules` and fails to resolve `npm:` specifiers.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `scripts/sync-mirrors.mjs` | Generates every dual-homed file/block from its source | Create |
| `scripts/mirrors.manifest.json` | The source-to-target list the generator reads | Create |
| `src/lib/hireOrders/feeBasis.ts` | `FeeBasis` type + `computeFeeTotal` (cents-safe). **Mirror source.** | Create |
| `supabase/functions/_shared/feeBasis.ts` | **Generated** mirror of the above | Generated |
| `src/lib/hireOrders/feeBasis.test.ts` | Unit tests for the above | Create |
| `supabase/functions/_shared/hireOrders.ts` | Re-exports `./feeBasis.ts`; adds `fee_basis`/`fee_per_date` to `OrderFieldKey` | Modify |
| `supabase/functions/_shared/hireOrders.test.ts` | Deno tests for the mirror | Modify |
| `src/lib/hireOrders/types.ts` | Adds `fee_basis`/`fee_per_date` to `OrderFieldKey`, widens `EditableOrderFieldKey` exclusion | Modify |
| `src/lib/hireOrders/types.test.ts` | Type-level guards | Modify |
| `src/components/settings/hireOrders/OrderDefaultsCard.tsx` | `default_fee_basis` field + picker | Modify |
| `src/components/settings/hireOrders/defaults.ts` | `ORDER_DEFAULTS_DEFAULT` gains the basis | Modify |
| `supabase/functions/generate-hire-orders/index.ts` | `fee_basis` on the batch body, validation, multiplication, snapshot write | Modify |
| `supabase/functions/generate-hire-orders/index.di.test.ts` | Edge contract tests | Modify |
| `src/lib/hireOrders/pdfCopy.ts` | Two new copy keys. **Mirror source**; edge copy regenerated | Modify |
| `src/components/settings/hireOrders/pdfCopyMeta.ts` | Section entries for the new keys | Modify |
| `supabase/functions/_shared/hire-order-pdf/render.tsx` | Per-date breakdown line in the fees section | Modify |
| `supabase/functions/_shared/hire-order-pdf/render.test.ts` | Renderer tests | Modify |
| `src/components/hireOrders/NewOrderWizard.tsx` | Basis toggle, helper text, `fee_basis` in body, date pre-selection | Modify |
| `src/components/hireOrders/NewOrderWizard.test.tsx` | Component tests | Modify |
| `public/changelog.md` + `public/changelog.json` | User-facing release notes | Modify |

---

## Task 0: Mirror generator

**Files:**
- Create: `scripts/sync-mirrors.mjs`
- Create: `scripts/mirrors.manifest.json`
- Create: `scripts/sync-mirrors.test.mjs`
- Modify: `package.json` (two scripts)
- Modify: `.github/workflows/ci.yml` (one check step)
- Modify: the generated target files, to carry a "generated" header

**Interfaces:**
- Produces: `npm run sync:mirrors` (writes every target from its source) and `npm run sync:mirrors:check` (exit 1 if any target is stale). Every later task that touches a mirrored file uses these.

Dual-homed files exist because the Deno edge runtime cannot import from `src/`. Today the second copy is hand-maintained and a vitest test catches drift **after** someone makes the mistake. This task makes the copy **derived**: one source of truth, a generated target, and a check that fails CI.

Three mirror kinds exist in this repo. The generator covers the first two:

| Kind | Example | Mode |
|---|---|---|
| Whole file identical | `src/lib/hireOrders/pdfCopy.ts` | `file` |
| Sentinel-delimited block | `src/lib/capabilities.ts` | `block` |
| Structural (5 files into 1) | `src/lib/hireOrders/types.ts` | not covered, stays hand-maintained |

Verified byte-equality before starting: `pdfCopy.ts` and `types.ts`/`database.types.ts` are already identical. `capabilities.ts` already carries `// >>> CAPABILITY REGISTRY MIRROR ... >>>` / `// <<< CAPABILITY REGISTRY MIRROR <<<` sentinels. `entitlements.ts` differs by 79 lines and has **no** sentinels.

- [ ] **Step 1: Write the failing test**

Create `scripts/sync-mirrors.test.mjs`, following the existing `scripts/check-migrations.test.mjs` for style and how it is run:

```js
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { syncMirrors } from "./sync-mirrors.mjs";

function scratch() {
  return mkdtempSync(join(tmpdir(), "mirrors-"));
}
function put(root, rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

describe("syncMirrors file mode", () => {
  it("writes the target from the source", () => {
    const root = scratch();
    put(root, "a.ts", "export const x = 1;\n");
    put(root, "b.ts", "stale\n");
    const result = syncMirrors({ root, entries: [{ mode: "file", source: "a.ts", target: "b.ts" }] });
    expect(readFileSync(join(root, "b.ts"), "utf8")).toBe("export const x = 1;\n");
    expect(result.written).toEqual(["b.ts"]);
  });

  it("reports nothing written when the target already matches", () => {
    const root = scratch();
    put(root, "a.ts", "same\n");
    put(root, "b.ts", "same\n");
    const result = syncMirrors({ root, entries: [{ mode: "file", source: "a.ts", target: "b.ts" }] });
    expect(result.written).toEqual([]);
  });

  it("check mode reports staleness without writing", () => {
    const root = scratch();
    put(root, "a.ts", "new\n");
    put(root, "b.ts", "old\n");
    const result = syncMirrors({ root, entries: [{ mode: "file", source: "a.ts", target: "b.ts" }], check: true });
    expect(result.stale).toEqual(["b.ts"]);
    expect(readFileSync(join(root, "b.ts"), "utf8")).toBe("old\n");
  });
});

describe("syncMirrors block mode", () => {
  const START = "// >>> M >>>";
  const END = "// <<< M <<<";
  const entry = { mode: "block", source: "a.ts", target: "b.ts", start: START, end: END };

  it("replaces only the delimited block, preserving the rest of the target", () => {
    const root = scratch();
    put(root, "a.ts", `import x from "npm:x";\n${START}\nexport const R = 1;\n${END}\nsource tail\n`);
    put(root, "b.ts", `import x from "x";\n${START}\nexport const R = 0;\n${END}\ntarget tail\n`);
    syncMirrors({ root, entries: [entry] });
    const out = readFileSync(join(root, "b.ts"), "utf8");
    expect(out).toContain('import x from "x";');
    expect(out).toContain("export const R = 1;");
    expect(out).toContain("target tail");
    expect(out).not.toContain("source tail");
  });

  it("throws a named error when a sentinel is missing", () => {
    const root = scratch();
    put(root, "a.ts", `${START}\nx\n${END}\n`);
    put(root, "b.ts", "no sentinels here\n");
    expect(() => syncMirrors({ root, entries: [entry] })).toThrow(/sentinel/i);
  });
});

describe("the real manifest", () => {
  it("is already in sync, so a clean checkout passes check mode", () => {
    const result = syncMirrors({ check: true });
    expect(result.stale).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/sync-mirrors.test.mjs`
Expected: FAIL, cannot resolve `./sync-mirrors.mjs`.

If vitest does not pick up files under `scripts/`, check `vite.config.ts` / `vitest` config for an `include` pattern and extend it to cover `scripts/**/*.test.mjs`. `scripts/check-migrations.test.mjs` already exists, so confirm how that one runs and match it.

- [ ] **Step 3: Write the manifest**

Create `scripts/mirrors.manifest.json`:

```json
{
  "entries": [
    {
      "mode": "file",
      "source": "src/lib/hireOrders/pdfCopy.ts",
      "target": "supabase/functions/_shared/hire-order-pdf/pdfCopy.ts",
      "why": "Editable PDF copy registry. Edge renderer reads it and freezes it into issue_snapshot."
    },
    {
      "mode": "file",
      "source": "src/integrations/supabase/types.ts",
      "target": "supabase/functions/_shared/database.types.ts",
      "why": "Generated Supabase types. Source is itself generated; never hand-edit either side."
    },
    {
      "mode": "block",
      "source": "src/lib/capabilities.ts",
      "target": "supabase/functions/_shared/capabilities.ts",
      "start": "// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>",
      "end": "// <<< CAPABILITY REGISTRY MIRROR <<<",
      "why": "Role x action registry. The surrounding imports and helpers differ per runtime."
    }
  ]
}
```

`entitlements.ts` is deliberately **not** in the manifest yet: it differs by 79 lines and has no sentinels. If, after reading both files, the shared registry is one contiguous region, add the same sentinel pair around it in both files and add a `block` entry. If it is not contiguous, leave it out and say so in your report. Do not restructure `entitlements.ts` to force it to fit.

`hireOrders.ts` and the consent-text pair are out of scope: the first is structural (five source files combined into one), the second is a single string literal in two unrelated application files. Their existing tests stay.

- [ ] **Step 4: Write the generator**

Create `scripts/sync-mirrors.mjs`:

```js
#!/usr/bin/env node
// Generates every dual-homed file from its single source of truth.
//
// WHY THIS EXISTS: the Deno edge runtime cannot import from src/ (incompatible
// module specifier dialects, and Supabase deploys only what is under
// supabase/functions/), so shared code has to exist twice. This script makes
// the second copy DERIVED rather than duplicated: edit the source, run
// `npm run sync:mirrors`. `npm run sync:mirrors:check` fails CI when a target
// is stale or was hand-edited.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Header stamped onto every generated target, so a reader who opens the file
 *  directly learns not to edit it. Kept out of the byte comparison by being
 *  part of the produced content on both sides of the compare. */
function stamp(sourcePath) {
  return `// GENERATED FILE. Do not edit.\n` +
    `// Source: ${sourcePath}\n` +
    `// Regenerate: npm run sync:mirrors\n`;
}

function readBlock(text, start, end, path) {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s === -1 || e === -1) {
    throw new Error(`mirror sentinel not found in ${path} (looked for ${start})`);
  }
  return text.slice(s, e + end.length);
}

function renderTarget(entry, root) {
  const sourceText = readFileSync(join(root, entry.source), "utf8");
  if (entry.mode === "file") {
    return stamp(entry.source) + sourceText;
  }
  if (entry.mode === "block") {
    const targetPath = join(root, entry.target);
    const targetText = readFileSync(targetPath, "utf8");
    const sourceBlock = readBlock(sourceText, entry.start, entry.end, entry.source);
    const targetBlock = readBlock(targetText, entry.start, entry.end, entry.target);
    return targetText.replace(targetBlock, sourceBlock);
  }
  throw new Error(`unknown mirror mode "${entry.mode}" for ${entry.target}`);
}

/**
 * Sync (or check) every manifest entry.
 * @param {{root?: string, entries?: object[], check?: boolean}} options
 * @returns {{written: string[], stale: string[]}}
 */
export function syncMirrors(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const entries = options.entries ??
    JSON.parse(readFileSync(join(root, "scripts/mirrors.manifest.json"), "utf8")).entries;

  const written = [];
  const stale = [];
  for (const entry of entries) {
    const targetPath = join(root, entry.target);
    const desired = renderTarget(entry, root);
    let current = null;
    try {
      current = readFileSync(targetPath, "utf8");
    } catch {
      current = null;
    }
    if (current === desired) continue;
    if (options.check) {
      stale.push(entry.target);
    } else {
      writeFileSync(targetPath, desired, "utf8");
      written.push(entry.target);
    }
  }
  return { written, stale };
}

// CLI. Not run on import, so the tests can call syncMirrors directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { written, stale } = syncMirrors({ check });
  if (check && stale.length > 0) {
    console.error(
      `Mirror targets are stale:\n${stale.map((t) => `  ${t}`).join("\n")}\n\n` +
        `Edit the SOURCE file, then run: npm run sync:mirrors`,
    );
    process.exit(1);
  }
  if (check) {
    console.log("All mirrors in sync.");
  } else {
    console.log(
      written.length === 0
        ? "All mirrors already in sync."
        : `Regenerated:\n${written.map((t) => `  ${t}`).join("\n")}`,
    );
  }
}
```

Note the `file` mode stamps a generated header onto the target. That means the target is no longer byte-identical to the source, so **the existing `pdfCopyMirror.test.ts` and `typesMirror.test.ts` will fail**. Update them in Step 6 to assert what is now true.

- [ ] **Step 5: Run the generator and inspect the result**

```bash
node scripts/sync-mirrors.mjs
git diff --stat
```

Expected: the two `file` targets gain a three-line generated header; the `capabilities.ts` block target is unchanged (already in sync). If any target changes by more than its header, the two copies had already drifted. Stop and report that in your report before continuing: it is a real pre-existing bug, not a generator problem.

- [ ] **Step 6: Update the superseded mirror tests**

`src/lib/hireOrders/pdfCopyMirror.test.ts` and `src/integrations/supabase/typesMirror.test.ts` currently assert raw byte-equality, which the generated header breaks. Rewrite each to assert the target is what the generator would produce, which is the stronger claim:

```ts
import { describe, expect, it } from "vitest";
import { syncMirrors } from "../../../scripts/sync-mirrors.mjs";

// The edge runtime cannot import from src/, so this file is dual-homed. It is
// GENERATED from its source by scripts/sync-mirrors.mjs; this test fails if the
// target was hand-edited or the source changed without a regen.
describe("hire-order pdf copy mirror", () => {
  it("the generated target is in sync with its source", () => {
    expect(syncMirrors({ check: true }).stale).toEqual([]);
  });
});
```

Both files now assert the same manifest-wide property, so keep only **one** of them and delete the other, leaving a one-line comment at the deleted file's former subject pointing at the surviving test. Keep `capabilitiesMirror.test.ts` and `consentTextMirror.test.ts` as they are: the first is now covered by the manifest but harmlessly, the second is not covered at all.

Correct the relative import depth for wherever you keep the surviving test.

- [ ] **Step 7: Add the npm scripts**

In `package.json`:

```json
    "sync:mirrors": "node scripts/sync-mirrors.mjs",
    "sync:mirrors:check": "node scripts/sync-mirrors.mjs --check",
```

- [ ] **Step 8: Wire the check into CI**

In `.github/workflows/ci.yml`, add a step to the job that already runs `npm ci` and `npm run lint`, placed immediately before the lint step:

```yaml
      - name: Check generated mirrors are in sync
        run: npm run sync:mirrors:check
```

Read the file first and match its existing indentation and step style exactly.

- [ ] **Step 9: Run the full gate**

Run: `npx vitest run && npm run lint && npm run sync:mirrors:check && deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS on all four. The Deno suite matters here because the generated header is new content at the top of two files it compiles.

- [ ] **Step 10: Commit**

```bash
git add scripts/ package.json .github/workflows/ci.yml src/ supabase/
git commit -m "build: generate dual-homed mirrors instead of hand-copying"
```

---

## Task 1: Cents-safe fee multiplication

**Files:**
- Create: `src/lib/hireOrders/feeBasis.ts` (**mirror source**)
- Create: `src/lib/hireOrders/feeBasis.test.ts`
- Generated: `supabase/functions/_shared/feeBasis.ts` (by `npm run sync:mirrors`, never hand-written)
- Modify: `scripts/mirrors.manifest.json` (one new `file` entry)
- Modify: `supabase/functions/_shared/hireOrders.ts` (re-export the generated module)
- Modify: `supabase/functions/_shared/hireOrders.test.ts`

**Interfaces:**
- Consumes: `npm run sync:mirrors` (Task 0).
- Produces: `type FeeBasis = "per_date" | "total"` and `computeFeeTotal(perDateAmount: number, dateCount: number, basis: FeeBasis): number`, exported from **both** runtimes. Tasks 4 and 6 consume it.

This is a separate file from `money.ts` on purpose: that file's header states it is display-only and "never computes with floats". Arithmetic belongs elsewhere.

It is also a standalone file on the edge side rather than a new section appended into `_shared/hireOrders.ts`, so the pair is a clean whole-file mirror the Task 0 generator can own. `_shared/hireOrders.ts` re-exports it, so every existing edge import path keeps working.

- [ ] **Step 1: Write the failing test**

Create `src/lib/hireOrders/feeBasis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeFeeTotal } from "./feeBasis";

describe("computeFeeTotal", () => {
  it("returns the amount unchanged for a total basis, whatever the date count", () => {
    expect(computeFeeTotal(1500, 3, "total")).toBe(1500);
    expect(computeFeeTotal(1500, 1, "total")).toBe(1500);
  });

  it("multiplies by the date count for a per-date basis", () => {
    expect(computeFeeTotal(500, 3, "per_date")).toBe(1500);
  });

  it("is exact for amounts with cents (no float drift)", () => {
    // 500.1 * 3 in floating point is 1500.3000000000002.
    expect(computeFeeTotal(500.1, 3, "per_date")).toBe(1500.3);
    expect(computeFeeTotal(33.33, 3, "per_date")).toBe(99.99);
  });

  it("is a no-op for a single date", () => {
    expect(computeFeeTotal(500, 1, "per_date")).toBe(500);
  });

  it("returns the amount unchanged for a nonsensical date count", () => {
    expect(computeFeeTotal(500, 0, "per_date")).toBe(500);
    expect(computeFeeTotal(500, -2, "per_date")).toBe(500);
    expect(computeFeeTotal(500, 1.5, "per_date")).toBe(500);
  });

  it("returns the amount unchanged when it is not finite", () => {
    expect(computeFeeTotal(Number.NaN, 3, "per_date")).toBeNaN();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/feeBasis.test.ts`
Expected: FAIL, cannot resolve `./feeBasis`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/hireOrders/feeBasis.ts`:

```ts
// How a producer entered the engagement fee for an aggregate (multi-date) order.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same type +
// function (the two runtimes cannot share an import). Change both files in the
// same commit.

/** "per_date": the entered amount is charged once per engagement date.
 *  "total": the entered amount already covers every date. */
export type FeeBasis = "per_date" | "total";

/**
 * Total payable for an order, given the amount the producer typed and how many
 * engagement dates the order actually covers.
 *
 * Multiplies in integer cents: `500.1 * 3` in binary floating point is
 * 1500.3000000000002, which would be stored and printed verbatim.
 *
 * Defensive no-ops (return the amount unchanged) for a non-finite amount or a
 * date count that is not a positive integer, so a malformed caller can never
 * turn a real fee into NaN or zero.
 */
export function computeFeeTotal(
  perDateAmount: number,
  dateCount: number,
  basis: FeeBasis,
): number {
  if (basis === "total") return perDateAmount;
  if (!Number.isFinite(perDateAmount)) return perDateAmount;
  if (!Number.isInteger(dateCount) || dateCount < 1) return perDateAmount;
  return (Math.round(perDateAmount * 100) * dateCount) / 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/feeBasis.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Generate the edge mirror**

Add one entry to `scripts/mirrors.manifest.json`:

```json
    {
      "mode": "file",
      "source": "src/lib/hireOrders/feeBasis.ts",
      "target": "supabase/functions/_shared/feeBasis.ts",
      "why": "Fee basis type + cents-safe multiplication, used by the frontend wizard and the draft-batch edge action."
    }
```

Then generate it:

```bash
npm run sync:mirrors
```

Expected output names `supabase/functions/_shared/feeBasis.ts` as regenerated. **Do not hand-write that file.** Confirm it exists and carries the generated header.

Then re-export it from `supabase/functions/_shared/hireOrders.ts`, so every existing edge import path keeps resolving. Add immediately after the `formatMoney` function (which currently ends at line 198) and before the `// ── validate ──` banner:

```ts
// ── fee basis ────────────────────────────────────────────────────────────
// Re-exported from the generated mirror of src/lib/hireOrders/feeBasis.ts, so
// callers keep importing everything hire-order from this one module.
export { computeFeeTotal, type FeeBasis } from "./feeBasis.ts";
```

- [ ] **Step 6: Add the edge test**

Append to `supabase/functions/_shared/hireOrders.test.ts`:

```ts
Deno.test("computeFeeTotal multiplies per-date fees in exact cents", () => {
  assertEquals(computeFeeTotal(500, 3, "per_date"), 1500);
  assertEquals(computeFeeTotal(500.1, 3, "per_date"), 1500.3);
  assertEquals(computeFeeTotal(500, 1, "per_date"), 500);
});

Deno.test("computeFeeTotal leaves a total-basis fee alone", () => {
  assertEquals(computeFeeTotal(1500, 3, "total"), 1500);
});

Deno.test("computeFeeTotal no-ops on a nonsensical date count", () => {
  assertEquals(computeFeeTotal(500, 0, "per_date"), 500);
  assertEquals(computeFeeTotal(500, -2, "per_date"), 500);
});
```

Add `computeFeeTotal` to the existing import from `./hireOrders.ts` at the top of that file.

- [ ] **Step 7: Run the edge tests**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hireOrders.test.ts`
Expected: PASS, including the 3 new tests.

- [ ] **Step 8: Commit**

```bash
git add src/lib/hireOrders/feeBasis.ts src/lib/hireOrders/feeBasis.test.ts supabase/functions/_shared/hireOrders.ts supabase/functions/_shared/hireOrders.test.ts
git commit -m "feat(hire-orders): cents-safe per-date fee multiplication"
```

---

## Task 2: Snapshot field keys

**Files:**
- Modify: `src/lib/hireOrders/types.ts:20-56`
- Modify: `src/lib/hireOrders/types.test.ts`
- Modify: `supabase/functions/_shared/hireOrders.ts:32-73`

**Interfaces:**
- Consumes: nothing.
- Produces: `OrderFieldKey` gains `"fee_basis" | "fee_per_date"`; `EditableOrderFieldKey` becomes `Exclude<OrderFieldKey, "engagement_dates" | "fee_basis" | "fee_per_date">`. `ORDER_FIELD_KEYS` is **unchanged**. Task 4 writes these fields, Task 5 reads them.

These two fields are derived by the server, never hand-edited, so they must stay out of `EditableOrderFieldKey` (which types the `manual` layer and the edit page's field list).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/hireOrders/types.test.ts`:

```ts
import { ORDER_FIELD_KEYS, type EditableOrderFieldKey, type OrderData } from "./types";

describe("derived fee snapshot fields", () => {
  it("stores fee_basis and fee_per_date on OrderData", () => {
    const data: OrderData = {
      fee: { value: 1500, source: "manual" },
      fee_basis: { value: "per_date", source: "manual" },
      fee_per_date: { value: 500, source: "manual" },
    };
    expect(data.fee_basis?.value).toBe("per_date");
    expect(data.fee_per_date?.value).toBe(500);
  });

  it("keeps them out of the editable field list", () => {
    expect(ORDER_FIELD_KEYS).not.toContain("fee_basis" as EditableOrderFieldKey);
    expect(ORDER_FIELD_KEYS).not.toContain("fee_per_date" as EditableOrderFieldKey);
    // The editable list is unchanged by this task.
    expect(ORDER_FIELD_KEYS).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/types.test.ts`
Expected: FAIL, `fee_basis` does not exist on type `OrderData`.

- [ ] **Step 3: Implement in the frontend mirror**

In `src/lib/hireOrders/types.ts`, extend the union and widen the exclusion:

```ts
export type OrderFieldKey =
  | "artist_name"
  | "recipient_email"
  | "role"
  | "cast"
  | "date"
  | "venue"
  | "city"
  | "duration_min"
  | "sessions"
  | "fee"
  | "currency"
  | "notes"
  | "engagement_dates"
  // Derived by the server from the producer's fee entry, never hand-edited:
  // `fee` always holds the TOTAL payable, these two explain how it was reached.
  | "fee_basis"
  | "fee_per_date";

export type EditableOrderFieldKey = Exclude<
  OrderFieldKey,
  "engagement_dates" | "fee_basis" | "fee_per_date"
>;
```

Leave `ORDER_FIELD_KEYS` exactly as it is.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply the identical change to the edge mirror**

Make the same two edits in `supabase/functions/_shared/hireOrders.ts` (the `OrderFieldKey` union at line 32 and the `EditableOrderFieldKey` alias at line 47), with the same comment.

- [ ] **Step 6: Verify nothing else broke**

Run: `npx tsc -p tsconfig.app.json --noEmit && deno check --node-modules-dir=none supabase/functions/_shared/hireOrders.ts`
Expected: no errors. If `resolveFields` or the edit page complains, it means something iterated `OrderFieldKey` instead of `ORDER_FIELD_KEYS`; fix it to use `ORDER_FIELD_KEYS`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hireOrders/types.ts src/lib/hireOrders/types.test.ts supabase/functions/_shared/hireOrders.ts
git commit -m "feat(hire-orders): fee_basis + fee_per_date snapshot field keys"
```

---

## Task 3: Default fee basis in order defaults

**Files:**
- Modify: `src/components/settings/hireOrders/defaults.ts:20`
- Modify: `src/components/settings/hireOrders/OrderDefaultsCard.tsx:17-20` (interface) and the form grid
- Modify: `supabase/functions/generate-hire-orders/index.ts` (the `OrderDefaults` interface and `DEFAULTS_DEFAULT`)
- Create: `src/components/settings/hireOrders/OrderDefaultsCard.test.tsx`

**Interfaces:**
- Consumes: `FeeBasis` from Task 1.
- Produces: `HireOrderDefaults` gains `default_fee_basis: FeeBasis`. Task 6 reads it to seed the wizard.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/hireOrders/OrderDefaultsCard.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrderDefaultsCard } from "./OrderDefaultsCard";

describe("OrderDefaultsCard fee basis", () => {
  it("shows a fee basis control defaulting to per date", async () => {
    renderWithProviders(<OrderDefaultsCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toBeInTheDocument());
    expect(screen.getByLabelText("Fee basis")).toHaveTextContent("Per date");
  });

  it("disables the fee basis control in read-only mode", async () => {
    renderWithProviders(<OrderDefaultsCard orgId="org-1" readOnly />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toBeDisabled());
    expect(screen.getByLabelText("Fee basis")).toBeDisabled();
  });
});
```

Note: `renderWithProviders` is the repo's harness at `src/test/renderWithProviders.tsx`. If the Supabase read needs stubbing, follow the pattern already used in `src/components/settings/hireOrders/LetterheadCard.test.tsx`, which is the closest sibling. Do **not** hand-roll `vi.mock('@/integrations/supabase/client')`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/OrderDefaultsCard.test.tsx`
Expected: FAIL, unable to find a label "Fee basis".

- [ ] **Step 3: Extend the type and default**

In `src/components/settings/hireOrders/OrderDefaultsCard.tsx`:

```ts
import type { FeeBasis } from "@/lib/hireOrders/feeBasis";

/** The `hire_order_defaults` app_settings value (spec §2.3 / §2.6). */
export interface HireOrderDefaults {
  default_fee: number | null;
  currency: string;
  /** Whether `default_fee` is charged once per engagement date or covers the
   *  whole engagement. Prefills the wizard; a producer can switch per order. */
  default_fee_basis: FeeBasis;
}
```

In `src/components/settings/hireOrders/defaults.ts`:

```ts
export const ORDER_DEFAULTS_DEFAULT: HireOrderDefaults = {
  default_fee: null,
  currency: "EUR",
  default_fee_basis: "per_date",
};
```

- [ ] **Step 4: Add the control**

In `OrderDefaultsCard.tsx`, add a third cell to the form grid, after the Currency cell. Change the wrapping grid class from `sm:grid-cols-2` to `sm:grid-cols-3`:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="ho-fee-basis">Fee basis</Label>
  <Select
    value={form.default_fee_basis}
    onValueChange={(v) => setForm((f) => ({ ...f, default_fee_basis: v as FeeBasis }))}
    disabled={readOnly}
  >
    <SelectTrigger id="ho-fee-basis" aria-label="Fee basis"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="per_date">Per date</SelectItem>
      <SelectItem value="total">Total for all dates</SelectItem>
    </SelectContent>
  </Select>
</div>
```

Update the card description so the meaning is stated where the value is set:

```tsx
<CardDescription>
  Prefills a new hire order's fee, basis, and currency. A per-date fee is multiplied by the
  number of engagement dates on the order. A producer can always adjust it per order.
</CardDescription>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/settings/hireOrders/OrderDefaultsCard.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Mirror the type in the edge function**

In `supabase/functions/generate-hire-orders/index.ts`, find the `OrderDefaults` interface and its `DEFAULTS_DEFAULT` constant. Add the field to both:

```ts
interface OrderDefaults {
  default_fee: number | null;
  currency: string;
  default_fee_basis: FeeBasis;
}

const DEFAULTS_DEFAULT: OrderDefaults = {
  default_fee: null,
  currency: "EUR",
  default_fee_basis: "per_date",
};
```

Add `FeeBasis` to the existing import from `../_shared/hireOrders.ts`.

Orgs that saved defaults before this change have no `default_fee_basis` key. `resolveOrgSetting` merges the stored value over the default object, so a missing key resolves to `"per_date"`. Confirm that by reading `resolveOrgSetting` in `supabase/functions/_shared/settings.ts`; if it replaces rather than merges, coerce at the read site with `defaults.default_fee_basis ?? "per_date"`.

- [ ] **Step 7: Run the full check**

Run: `npx vitest run src/components/settings/ && npm run lint`
Expected: PASS, no lint warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/hireOrders/ supabase/functions/generate-hire-orders/index.ts
git commit -m "feat(hire-orders): default fee basis in order defaults"
```

---

## Task 4: Server-side per-date multiplication

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts` (`DraftBatchBody` at line 841, `draftBatch` validation around line 990, `BatchDraftContext` at line 861, `draftBatchArtist` at line 1175)
- Modify: `supabase/functions/generate-hire-orders/index.di.test.ts`

**Interfaces:**
- Consumes: `computeFeeTotal`, `FeeBasis` (Task 1); the `fee_basis`/`fee_per_date` keys (Task 2); `OrderDefaults.default_fee_basis` (Task 3).
- Produces: the batch body accepts an optional top-level `fee_basis`. Task 6 sends it.

`fee_basis` is a **top-level body field, not part of `manual`**: the manual dict is typed `Partial<Record<EditableOrderFieldKey, unknown>>` and the basis is deliberately not an editable order field.

The multiplication must happen **after** the covered-date drop. `draftBatchArtist` computes `allDates`, then filters out dates an active order already covers into `dates`. A three-date request that drops one covered date must bill two dates.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/generate-hire-orders/index.di.test.ts`. Follow the existing `draft-batch` test in that file for how to build `makeFakeDeps` and the fake tables; reuse its fixture setup verbatim rather than inventing a new one.

```ts
Deno.test("draft-batch multiplies a per-date fee by the artist's date count", async () => {
  const { deps, inserted } = makeBatchDeps({
    dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
  });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2, DATE_3] }],
      manual: { fee: 500 },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const order = inserted.hire_orders[0];
  assertEquals(order.data.fee.value, 1500);
  assertEquals(order.data.fee_per_date.value, 500);
  assertEquals(order.data.fee_basis.value, "per_date");
  assertEquals(order.fee_amount, 1500);
});

Deno.test("draft-batch bills only the dates that survive the covered-date drop", async () => {
  // DATE_3 is already covered by an active order for this artist.
  const { deps, inserted } = makeBatchDeps({
    dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
    coveredDateIds: [DATE_3],
  });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2, DATE_3] }],
      manual: { fee: 500 },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  // Two dates survive, so the total is 1000 and not 1500.
  assertEquals(inserted.hire_orders[0].data.fee.value, 1000);
});

Deno.test("draft-batch leaves a total-basis fee unmultiplied and records no per-date amount", async () => {
  const { deps, inserted } = makeBatchDeps({ dates: ["2026-06-15", "2026-06-16"] });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2] }],
      manual: { fee: 1500 },
      fee_basis: "total",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const order = inserted.hire_orders[0];
  assertEquals(order.data.fee.value, 1500);
  assertEquals(order.data.fee_basis.value, "total");
  assertEquals(order.data.fee_per_date, undefined);
});

Deno.test("draft-batch refuses to bill an order with no surviving dates", async () => {
  // Regression guard for the persistence-boundary check. computeFeeTotal is
  // deliberately lenient about a bad date count (the wizard needs that for live
  // display), so the server must not rely on it to catch this. Reaching this
  // state requires the covered-date early return to be bypassed, which is why
  // the fixture forces an empty surviving set directly.
  const { deps, inserted } = makeBatchDeps({ dates: [], forceEmptySurvivingDates: true });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1] }],
      manual: { fee: 500 },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  // No order is written, and the failure is named rather than silent.
  assertEquals(inserted.hire_orders.length, 0);
  assertEquals((await res.json()).errors[0].reason, "no_billable_dates");
});

Deno.test("draft-batch rejects an unknown fee_basis", async () => {
  const { deps } = makeBatchDeps({ dates: ["2026-06-15"] });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1] }],
      manual: { fee: 500 },
      fee_basis: "weekly",
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "invalid_fee_basis");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts`
Expected: FAIL. The first test fails on `fee.value` being 500 rather than 1500; the last fails with status 200 rather than 400.

- [ ] **Step 3: Accept and validate the body field**

In `DraftBatchBody` (line 841):

```ts
interface DraftBatchBody {
  org_id: string;
  artists: DraftBatchArtistInput[];
  manual?: NonNullable<FieldLayers["manual"]>;
  /** How `manual.fee` should be read. Top-level rather than inside `manual`
   *  because the basis is not an editable order field. Omitted falls back to
   *  the org's `default_fee_basis`. */
  fee_basis?: FeeBasis;
  date_overrides?: Record<string, SessionOverride>;
}
```

In `draftBatch`, immediately after the existing `invalid_fee` guard:

```ts
if (
  body.fee_basis !== undefined &&
  body.fee_basis !== "per_date" && body.fee_basis !== "total"
) {
  return json({ error: "invalid_fee_basis" }, 400);
}
```

- [ ] **Step 4: Thread the basis through the batch context**

Add to `BatchDraftContext` (line 861):

```ts
  /** Resolved once for the batch: the request's basis, else the org default. */
  feeBasis: FeeBasis;
```

Where the context object is built in `draftBatch` (alongside `defaults`, `numbering`, and the other resolved values), add:

```ts
  feeBasis: body.fee_basis ?? defaults.default_fee_basis ?? "per_date",
```

- [ ] **Step 5: Multiply in draftBatchArtist**

In `draftBatchArtist`, destructure `feeBasis` from `context` alongside the existing fields. Then replace the existing fee block (currently around line 1264):

```ts
  const feeValue = data.fee?.value;
  const feeAmount =
    feeValue === undefined || feeValue === null || feeValue === ""
      ? null
      : Number(feeValue);
```

with:

```ts
  // `data.fee` is the amount the producer entered. For a per-date basis it is a
  // UNIT price, so the stored fee becomes unit x the dates that SURVIVED the
  // covered-date drop above (`dates`, not `allDates`): a 3-date request that
  // drops one already-covered date bills 2. The stored `fee` is always the TOTAL
  // payable, which is what every consumer (KPIs, readiness, the PDF total)
  // expects; `fee_basis` and `fee_per_date` only explain how it was reached.
  const enteredFeeValue = data.fee?.value;
  const enteredFee =
    enteredFeeValue === undefined || enteredFeeValue === null ||
      enteredFeeValue === ""
      ? null
      : Number(enteredFeeValue);
  // Guard the persistence boundary. computeFeeTotal is deliberately total: it
  // returns the amount unchanged for a date count that is not a positive
  // integer, because the wizard also calls it for live display where a zero
  // count is a normal transient state mid-edit. That leniency is wrong HERE,
  // where the result is about to be billed: a zero count would silently store
  // the single-date fee as the whole engagement's total. `dates.length >= 1` is
  // already guaranteed by the early return above, so this can only fire if a
  // future refactor removes that guard.
  if (!Number.isInteger(dates.length) || dates.length < 1) {
    return { kind: "error", reason: "no_billable_dates" };
  }
  const feeAmount = enteredFee === null
    ? null
    : computeFeeTotal(enteredFee, dates.length, feeBasis);
  if (feeAmount !== null) {
    const feeSource = data.fee?.source ?? "manual";
    data.fee = { value: feeAmount, source: feeSource };
    data.fee_basis = { value: feeBasis, source: feeSource };
    if (feeBasis === "per_date") {
      data.fee_per_date = { value: enteredFee, source: feeSource };
    }
  }
```

Add `computeFeeTotal` to the existing import from `../_shared/hireOrders.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts`
Expected: PASS, including the 4 new tests.

- [ ] **Step 7: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS. Per the repo's history, edge functions have multiple test files (`index.di.test.ts` is the broad contract suite); a single-file run has previously hidden regressions, so this full run is required before committing.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/generate-hire-orders/
git commit -m "feat(hire-orders): bill per-date fees by surviving date count"
```

---

## Task 5: Per-date breakdown on the PDF

**Files:**
- Modify: `src/lib/hireOrders/pdfCopy.ts` (**mirror source**; the edge copy is regenerated, never hand-edited)
- Modify: `src/components/settings/hireOrders/pdfCopyMeta.ts:86-92`
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx:501-512`
- Modify: `supabase/functions/_shared/hire-order-pdf/render.test.ts`

**Interfaces:**
- Consumes: the `fee_basis`/`fee_per_date` snapshot fields (Task 2), written by Task 4.
- Produces: copy keys `fees_per_date` and `fees_per_date_single`.

Note the existing guard: `src/components/settings/hireOrders/pdfCopyMeta.test.ts` asserts every `CopyKey` appears in exactly one section. Adding a key without a section entry fails that test, which is the intended behaviour.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/hire-order-pdf/render.test.ts`, following the existing text-extraction helper in that file:

```ts
Deno.test("fees section prints a per-date breakdown for an aggregate order", async () => {
  const text = await renderToText({
    ...baseInput,
    data: {
      ...baseInput.data,
      fee: { value: 1500, source: "manual" },
      fee_basis: { value: "per_date", source: "manual" },
      fee_per_date: { value: 500, source: "manual" },
      engagement_dates: {
        value: [
          { show_date_id: "d1", date: "2026-06-15", venue: "A", city: "Berlin" },
          { show_date_id: "d2", date: "2026-06-16", venue: "B", city: "Hamburg" },
          { show_date_id: "d3", date: "2026-06-17", venue: "C", city: "Munich" },
        ],
        source: "showflow",
      },
    },
  });
  assertStringIncludes(text, "500.00 per date x 3 dates");
  assertStringIncludes(text, "1,500.00");
});

Deno.test("fees section keeps the plain engagement-fee label for a total-basis order", async () => {
  const text = await renderToText({
    ...baseInput,
    data: {
      ...baseInput.data,
      fee: { value: 1500, source: "manual" },
      fee_basis: { value: "total", source: "manual" },
    },
  });
  assertStringIncludes(text, "Engagement fee");
  assertEquals(text.includes("per date"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`
Expected: FAIL, the rendered text does not contain "per date".

- [ ] **Step 3: Add the copy keys**

Edit **only** `src/lib/hireOrders/pdfCopy.ts` (the mirror source). Add to the `CopyKey` union under the `// Fees` comment:

```ts
  | "fees_heading"
  | "fees_engagement_fee"
  | "fees_per_date"
  | "fees_per_date_single"
  | "fees_total"
```

and to `HIRE_ORDER_COPY_DEFAULTS`:

```ts
  fees_heading: "Fees & payment schedule",
  fees_engagement_fee: "Engagement fee",
  fees_per_date: "{{amount}} per date x {{count}} dates",
  fees_per_date_single: "{{amount}} per date",
  fees_total: "Total payable",
```

No em or en dashes: "x" is the multiplication sign here, deliberately not the multiplication symbol, which the embedded fonts may not carry.

- [ ] **Step 4: Regenerate the edge mirror**

```bash
npm run sync:mirrors && npm run sync:mirrors:check
```

Expected: the first command names `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts` as regenerated, the second prints "All mirrors in sync." Never hand-edit the target.

- [ ] **Step 5: Register the keys in the settings metadata**

In `src/components/settings/hireOrders/pdfCopyMeta.ts`, replace the Fees section:

```ts
  {
    title: "Fees",
    fields: [
      { key: "fees_heading", label: "Fees heading", tokens: [] },
      { key: "fees_engagement_fee", label: "Engagement fee row", tokens: [] },
      { key: "fees_per_date", label: "Per-date breakdown row", tokens: ["amount", "count"] },
      { key: "fees_per_date_single", label: "Per-date breakdown row (one date)", tokens: ["amount"] },
      { key: "fees_total", label: "Total row", tokens: [] },
    ],
  },
```

- [ ] **Step 6: Render the breakdown**

In `render.tsx`, add near the other derived values in `HireOrderDoc` (after `const feeText = ...`):

```ts
  const feeBasis = str(data, "fee_basis");
  const feePerDateValue = data.fee_per_date?.value;
  // Aggregate orders carry engagement_dates; a single-date order has none, so
  // fall back to 1 rather than 0 (which would print "x 0 dates").
  const feeDateCount = engagementDates.length || 1;
  const feeBreakdown =
    feeBasis === "per_date" && feePerDateValue !== undefined &&
      feePerDateValue !== null && feePerDateValue !== ""
      ? applyTokens(
        feeDateCount === 1 ? copy.fees_per_date_single : copy.fees_per_date,
        {
          amount: formatMoney(feePerDateValue as string | number, currency),
          count: feeDateCount,
        },
      )
      : "";
```

`engagementDates` is already computed above this point (line 354). Then change the fee row label only:

```tsx
          <View style={s.feeRow}>
            <Text style={s.feeLabel}>{feeBreakdown || copy.fees_engagement_fee}</Text>
            <Text style={s.feeValue}>{feeText}</Text>
          </View>
```

Leave the total row untouched: `fee` is already the total.

- [ ] **Step 7: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`
Expected: PASS, including the 2 new tests.

- [ ] **Step 8: Run the copy metadata guard**

Run: `npx vitest run src/components/settings/hireOrders/pdfCopyMeta.test.ts src/lib/hireOrders/`
Expected: PASS. The coverage test proves both new keys are placed in exactly one section.

- [ ] **Step 9: Commit**

```bash
git add src/lib/hireOrders/pdfCopy.ts supabase/functions/_shared/hire-order-pdf/ src/components/settings/hireOrders/pdfCopyMeta.ts
git commit -m "feat(hire-orders): per-date fee breakdown line on the pdf"
```

---

## Task 6: Wizard fee basis control

**Files:**
- Modify: `src/components/hireOrders/NewOrderWizard.tsx` (state near line 243, `draftBody` near line 460, step 2 UI at lines 771-797)
- Modify: `src/components/hireOrders/NewOrderWizard.test.tsx`

**Interfaces:**
- Consumes: `computeFeeTotal`, `FeeBasis` (Task 1); `HireOrderDefaults.default_fee_basis` (Task 3); the `fee_basis` body field (Task 4).

- [ ] **Step 1: Write the failing test**

Append to `src/components/hireOrders/NewOrderWizard.test.tsx`, reusing that file's existing setup helpers for opening the dialog and reaching step 2:

```tsx
it("shows the per-date total for equal date counts", async () => {
  const user = userEvent.setup();
  await openWizardAtStep2(user, { artists: [ARTIST_A], dates: [DATE_1, DATE_2, DATE_3] });
  await user.clear(screen.getByLabelText("Engagement fee"));
  await user.type(screen.getByLabelText("Engagement fee"), "500");
  expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent(
    "€500.00 per date x 3 dates = €1,500.00",
  );
});

it("shows a range when artists have different date counts", async () => {
  const user = userEvent.setup();
  await openWizardAtStep2(user, {
    artists: [ARTIST_A, ARTIST_B],
    dates: [DATE_1, DATE_2, DATE_3],
    assignments: { [ARTIST_A]: [DATE_1], [ARTIST_B]: [DATE_1, DATE_2, DATE_3] },
  });
  await user.type(screen.getByLabelText("Engagement fee"), "500");
  expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent(
    "€500.00 per date. Totals range from €500.00 to €1,500.00 by artist.",
  );
});

it("shows the flat total when the basis is total", async () => {
  const user = userEvent.setup();
  await openWizardAtStep2(user, { artists: [ARTIST_A], dates: [DATE_1, DATE_2] });
  await user.type(screen.getByLabelText("Engagement fee"), "1500");
  await user.click(screen.getByLabelText("Fee basis"));
  await user.click(screen.getByRole("option", { name: "Total for all dates" }));
  expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent(
    "€1,500.00 total for all dates",
  );
});

it("sends fee_basis in the draft body", async () => {
  const user = userEvent.setup();
  const invoke = await completeWizard(user, { fee: "500", basis: "per_date" });
  expect(invoke.mock.calls[0][1].body).toMatchObject({
    action: "draft-batch",
    fee_basis: "per_date",
    manual: expect.objectContaining({ fee: 500 }),
  });
});
```

If `openWizardAtStep2` / `completeWizard` do not exist in that test file, write them as local helpers built from the existing tests' setup code. Do not duplicate production logic inside them.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/NewOrderWizard.test.tsx`
Expected: FAIL, no element with test id `wiz-fee-summary`.

- [ ] **Step 3: Add state and seed it from the org defaults**

Near the existing `const [fee, setFee] = useState("")` (line 243):

```ts
const [feeBasis, setFeeBasis] = useState<FeeBasis>("per_date");
```

In the effect that seeds from `defaultsQuery.data` (around line 229, beside `if (defaultsQuery.data.default_fee != null) setFee(...)`):

```ts
if (defaultsQuery.data.default_fee_basis) setFeeBasis(defaultsQuery.data.default_fee_basis);
```

Add `setFeeBasis("per_date")` to `resetForm` beside the other resets.

Import at the top:

```ts
import { computeFeeTotal, type FeeBasis } from "@/lib/hireOrders/feeBasis";
```

- [ ] **Step 4: Compute the summary line**

Add beside the other derived values (near `feeDisplay`, line 451):

```ts
// Per-artist date counts drive the fee summary: with a per-date basis each
// artist's total is their own count x the unit price, so unequal counts have no
// single total to show.
const feeAmountNum = fee.trim() !== "" && !Number.isNaN(Number(fee)) ? Number(fee) : null;
const artistDateCounts = manualMode
  ? [1]
  : selectedArtistIds.map((id) => (artistDateIds[id] ?? []).length).filter((n) => n > 0);
const minDateCount = artistDateCounts.length > 0 ? Math.min(...artistDateCounts) : 1;
const maxDateCount = artistDateCounts.length > 0 ? Math.max(...artistDateCounts) : 1;

function feeSummaryText(): string {
  if (feeAmountNum === null) return "Not set";
  const unit = formatMoney(feeAmountNum, currency);
  if (feeBasis === "total") return `${unit} total for all dates`;
  if (maxDateCount === 1 && minDateCount === 1) return `${unit} per date`;
  if (minDateCount === maxDateCount) {
    const total = formatMoney(computeFeeTotal(feeAmountNum, maxDateCount, "per_date"), currency);
    return `${unit} per date x ${maxDateCount} dates = ${total}`;
  }
  const low = formatMoney(computeFeeTotal(feeAmountNum, minDateCount, "per_date"), currency);
  const high = formatMoney(computeFeeTotal(feeAmountNum, maxDateCount, "per_date"), currency);
  return `${unit} per date. Totals range from ${low} to ${high} by artist.`;
}
```

- [ ] **Step 5: Add the control and replace the summary box**

In the step 2 block, change the grid from `sm:grid-cols-2` to `sm:grid-cols-3` and insert a basis cell between the fee and currency cells:

```tsx
<div className="space-y-1.5">
  <Label htmlFor="wiz-fee-basis">Fee basis</Label>
  <Select value={feeBasis} onValueChange={(v) => setFeeBasis(v as FeeBasis)}>
    <SelectTrigger id="wiz-fee-basis" aria-label="Fee basis"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="per_date">Per date</SelectItem>
      <SelectItem value="total">Total for all dates</SelectItem>
    </SelectContent>
  </Select>
</div>
```

Replace the existing summary box (lines 790-794) with:

```tsx
<div className="rounded-lg border border-accent-200 bg-accent-50 p-3">
  <p className="text-xs text-accent-700" data-testid="wiz-fee-summary">
    {feeSummaryText()}
  </p>
</div>
```

The old copy said "Payable on performance date", which was the exact ambiguity this task removes.

- [ ] **Step 6: Send the basis**

In `draftBody()`, add to the returned object in the non-manual branch, beside `manual`:

```ts
        fee_basis: feeBasis,
```

Also add it to the manual-mode branch's body so a single manual order records its basis consistently.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/NewOrderWizard.test.tsx`
Expected: PASS, including the 4 new tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/hireOrders/NewOrderWizard.tsx src/components/hireOrders/NewOrderWizard.test.tsx
git commit -m "feat(hire-orders): fee basis control in the new order wizard"
```

---

## Task 7: Wizard date pre-selection

**Files:**
- Modify: `src/components/hireOrders/NewOrderWizard.tsx:274-306` (`toggleArtist`, `toggleShowDate`)
- Modify: `src/components/hireOrders/NewOrderWizard.test.tsx`

**Interfaces:** none new.

Today `toggleShowDate` pushes onto `selectedShowDateIds` without touching `artistDateIds`, so the per-artist grid renders all-unchecked and `canContinueStep1` blocks until the producer presses "Apply selected dates to all". The fix makes selection propagate in both directions.

- [ ] **Step 1: Write the failing test**

Append to `src/components/hireOrders/NewOrderWizard.test.tsx`:

```tsx
it("pre-assigns a newly selected date to every selected artist", async () => {
  const user = userEvent.setup();
  await openWizardAtStep1(user, { artists: [ARTIST_A, ARTIST_B], dates: [DATE_1] });
  await selectArtists(user, ["Alex Rivera", "Sam Okafor"]);
  await selectDates(user, ["15/06/2026"]);
  expect(screen.getByRole("checkbox", { name: "Alex Rivera 15/06/2026" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sam Okafor 15/06/2026" })).toBeChecked();
});

it("seeds a newly selected artist with the dates already selected", async () => {
  const user = userEvent.setup();
  await openWizardAtStep1(user, { artists: [ARTIST_A, ARTIST_B], dates: [DATE_1, DATE_2] });
  await selectDates(user, ["15/06/2026", "16/06/2026"]);
  await selectArtists(user, ["Alex Rivera"]);
  expect(screen.getByRole("checkbox", { name: "Alex Rivera 15/06/2026" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Alex Rivera 16/06/2026" })).toBeChecked();
});

it("unblocks Continue without pressing Apply selected dates to all", async () => {
  const user = userEvent.setup();
  await openWizardAtStep1(user, { artists: [ARTIST_A], dates: [DATE_1] });
  await selectArtists(user, ["Alex Rivera"]);
  await selectDates(user, ["15/06/2026"]);
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});

it("still lets a producer deselect one artist's date", async () => {
  const user = userEvent.setup();
  await openWizardAtStep1(user, { artists: [ARTIST_A, ARTIST_B], dates: [DATE_1] });
  await selectArtists(user, ["Alex Rivera", "Sam Okafor"]);
  await selectDates(user, ["15/06/2026"]);
  await user.click(screen.getByRole("checkbox", { name: "Sam Okafor 15/06/2026" }));
  expect(screen.getByRole("checkbox", { name: "Alex Rivera 15/06/2026" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sam Okafor 15/06/2026" })).not.toBeChecked();
  // One artist now has no dates, so step 1 is incomplete again.
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});
```

The checkbox accessible names come from the existing grid markup: `aria-label={`${artist?.name ?? artistId} ${dateLabel}`}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/NewOrderWizard.test.tsx -t "pre-assigns"`
Expected: FAIL, the checkbox is not checked.

- [ ] **Step 3: Propagate selection in both directions**

Replace `toggleArtist` and `toggleShowDate`:

```ts
  function toggleArtist(id: string) {
    if (selectedArtistIds.includes(id)) {
      const nextArtistDateIds = { ...artistDateIds };
      delete nextArtistDateIds[id];
      setSelectedArtistIds((ids) => ids.filter((artistId) => artistId !== id));
      setArtistDateIds(nextArtistDateIds);
      return;
    }
    setSelectedArtistIds((ids) => [...ids, id]);
    // Seed a newly selected artist with every date already picked above, so the
    // common case (everyone plays every selected date) needs no grid work.
    setArtistDateIds((current) => ({
      ...current,
      [id]: current[id] ?? [...selectedShowDateIds],
    }));
  }

  function toggleShowDate(id: string) {
    if (selectedShowDateIds.includes(id)) {
      setSelectedShowDateIds((ids) => ids.filter((showDateId) => showDateId !== id));
      setArtistDateIds((current) =>
        Object.fromEntries(
          Object.entries(current).map(([artistId, ids]) => [
            artistId,
            ids.filter((showDateId) => showDateId !== id),
          ]),
        ),
      );
      return;
    }
    const nextSelected = [...selectedShowDateIds, id];
    setSelectedShowDateIds(nextSelected);
    // Assign the new date to every selected artist by default. Ordering follows
    // the common picker so the grid's columns and each row's set agree.
    setArtistDateIds((current) =>
      Object.fromEntries(
        Object.entries(current).map(([artistId, ids]) => [
          artistId,
          nextSelected.filter((showDateId) => ids.includes(showDateId) || showDateId === id),
        ]),
      ),
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/NewOrderWizard.test.tsx`
Expected: PASS, all tests including the pre-existing ones. If a pre-existing test asserted the grid starts empty, it encoded the bug: update it and note why in the commit body.

- [ ] **Step 5: Update the apply button's help**

The "Apply selected dates to all" button stays useful as a re-apply after manual deselection. Change its label to `Reset all to selected dates` so it no longer reads like a required step.

- [ ] **Step 6: Run the full frontend suite and lint**

Run: `npx vitest run && npm run lint`
Expected: PASS, zero lint warnings.

- [ ] **Step 7: Commit**

```bash
git add src/components/hireOrders/NewOrderWizard.tsx src/components/hireOrders/NewOrderWizard.test.tsx
git commit -m "fix(hire-orders): pre-assign selected dates to selected artists"
```

---

## Task 8: Changelog and version

**Files:**
- Modify: `public/changelog.md`
- Modify: `public/changelog.json` (regenerated, never hand-edited)
- Modify: `package.json` (`version`)
- Modify: `src/config/app.config.ts` (`APP_META.VERSION`, currently `1.12.0`)

New user-facing features, so this is a MINOR bump to `1.13.0`.

- [ ] **Step 1: Check for a same-day entry**

Run: `head -20 public/changelog.md`

If the newest block is already dated today (Jul 25, 2026), **add these bullets to that existing block** rather than creating a new version. Same-day changes fold into one version entry.

- [ ] **Step 2: Write the changelog block**

If no same-day block exists, add at the top of `public/changelog.md`:

```markdown
## 1.13.0 — Jul 25, 2026

*Clearer fees on multi-date hire orders*

### New
- **Fee per date or total** — When a hire order covers several dates, choose whether the engagement fee applies to each date or to the whole engagement. Per-date fees are multiplied by the number of dates, and the wizard shows the resulting total before you continue.
- **Fee breakdown on the PDF** — A per-date order now prints the unit fee and date count above the total, so the artist can see how the total was reached.

### Improved
- **Dates carry into the artist grid** — Dates picked in the first step of the new order wizard are now assigned to every selected artist automatically. Uncheck any that do not apply.
```

No em or en dashes in the bullet text itself. The `—` after the title and version is the established format in this file, so keep it there.

- [ ] **Step 3: Bump the version in both places**

`package.json`: `"version": "1.13.0"`
`src/config/app.config.ts`: `VERSION: '1.13.0'`

- [ ] **Step 4: Regenerate the JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten. Never hand-edit it.

- [ ] **Step 5: Verify**

Run: `git diff --stat public/ package.json src/config/app.config.ts`
Expected: four files changed.

- [ ] **Step 6: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "docs: changelog for per-date fees + wizard date pre-selection"
```

---

## Final verification

- [ ] Run the full gate: `npm run lint && npx vitest run && deno test --allow-all --node-modules-dir=none supabase/functions/`
- [ ] Confirm every command's output is green before claiming completion. Do not infer a pass from an absence of errors in a partial run.
- [ ] Manual check in the browser preview: open the hire-order wizard, select two artists and three dates, confirm the grid is pre-checked and Continue is enabled, then enter a fee of 500 and confirm the summary reads `€500.00 per date x 3 dates = €1,500.00`.
