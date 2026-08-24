# Mono For Machine Tokens Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict Geist Mono to machine tokens, and render every number the user reads in Geist Sans with tabular figures.

**Architecture:** The app has been using mono for two unrelated jobs at once: signalling "this is a machine token", and aligning columns of digits. Only the first needs mono. Geist Sans with `font-variant-numeric: tabular-nums` produces byte-identical column alignment (measured: `1111` and `8888` both render 38.41px at 16px, exactly matching Geist Mono, while default sans varies 22.66px to 38.66px). Splitting the two jobs lets `Metric` become sans-with-tabular for quantities, introduces a `Token` primitive for machine strings, and lets lint ban raw `font-mono` in feature code so the choice always goes through a primitive.

**Tech Stack:** React 18, Tailwind CSS 3, TypeScript, Vitest, ESLint.

**Spec:** The audit artifact at https://claude.ai/code/artifact/53d4c585-8dfa-4e4c-abbd-0831b3bfcb41, plus the owner's five decisions recorded below.

## The owner's decisions

Given on 2026-08-24 as comments on the artifact. Every ambiguous case was answered **sans**:

| case | decision |
|---|---|
| Step counters `3 / 5` | sans |
| KPI hero numbers (`Metric size="lg"`) | sans |
| Dates on a hire order | sans |
| Money in a table column | sans |
| Timestamps in the system health run log | sans |

The uniform answer settles the rule: **if a person reads it aloud as a quantity, a date, or a time, it is sans.** Mono survives only for machine tokens.

The owner's original framing: mono is for "documents or technical specifications or technical numbering", and explicitly not for Get running's top level UI.

## The rule this plan installs

1. **Mono is for machine tokens, not numbers.** Use mono only when the string is something a system produced and a person may need to copy, paste, or quote back: an id, a reference number, a key, a scope, a function name, a status code, a version string.
2. **Alignment is a separate decision.** Any number in a column, a table, a meter, or one that ticks live gets `tabular-nums`. That works in Geist Sans and is never a reason to reach for mono.
3. **Never mono a label.** Only a value can be a token. The word beside it never is.

## Global Constraints

- **npm only.** Never create `bun.lock`, `yarn.lock`, or `pnpm-lock.yaml`.
- **No raw values in feature code.** No hex, no `rgba()`, no `text-[13px]`, no bracket radius outside `src/components/ui`.
- **Radius utilities are `rounded-chip|field|control|card|icon|pill`.** Never a bare Tailwind side utility (`rounded-l` and friends are lint-banned).
- **No em dashes or en dashes in user-facing copy**, English or German. `src/i18n/copyLint.test.ts` enforces this for i18n bundles, help, minis and demo labels.
- **Lint runs at `--max-warnings 0`.** A warning fails the build.
- **Typecheck is three projects.** `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, and `deno check --node-modules-dir=none supabase/functions/*/index.ts`.
- **Do not edit** `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- **`deno.lock` is dirty** from an unrelated dependency re-resolution. Never stage it. Never use `git add -A` or `git add .`.

## Scale

- 212 raw `font-mono` uses plus 19 `<Metric>` uses, across 119 files.
- Roughly 26 are machine tokens that keep mono. The rest flip.
- This is **not** a safe blind codemod. Unlike the radius rename, every site needs a judgment call about whether the string is a token or a quantity. Tasks 3 and 4 are therefore per-area with a stated test, not a regex sweep.

## Out of scope

- `src/components/ui/**` primitives other than `metric.tsx` and the new `token.tsx`. Shared primitives are migrated only where they hardcode mono for a caller.
- PDF rendering (`src/lib/hireOrders/pdf/**`). A generated PDF is a document, and the owner's criterion explicitly allows mono there. Leave it alone and confirm in Task 6.
- Email templates under `supabase/functions/_shared/transactional-email-templates/`. Same reasoning.

---

### Task 1: The `Token` primitive and the `Metric` flip

**Files:**
- Create: `src/components/ui/token.tsx`
- Create: `src/components/ui/token.test.tsx`
- Modify: `src/components/ui/metric.tsx`
- Create: `src/components/ui/metric.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<Token>{string}</Token>` renders `font-mono`. `<Metric size="inline"|"body"|"lg">` renders `tabular-nums` in the inherited sans face, no `font-mono`. Every later task uses both.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/metric.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Metric } from './metric';

describe('Metric', () => {
  it('renders tabular figures without switching to mono', () => {
    render(<Metric>1240</Metric>);
    const el = screen.getByText('1240');
    expect(el.className).toContain('tabular-nums');
    expect(el.className).not.toContain('font-mono');
  });

  it('keeps tabular figures at every size', () => {
    for (const size of ['inline', 'body', 'lg'] as const) {
      const { unmount } = render(<Metric size={size}>{size}</Metric>);
      const el = screen.getByText(size);
      expect(el.className).toContain('tabular-nums');
      expect(el.className).not.toContain('font-mono');
      unmount();
    }
  });
});
```

Create `src/components/ui/token.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Token } from './token';

describe('Token', () => {
  it('renders a machine string in mono', () => {
    render(<Token>data.records:read</Token>);
    expect(screen.getByText('data.records:read').className).toContain('font-mono');
  });

  it('accepts a className without losing mono', () => {
    render(<Token className="text-muted-foreground">HO-2026-0042</Token>);
    const el = screen.getByText('HO-2026-0042');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('text-muted-foreground');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run src/components/ui/metric.test.tsx src/components/ui/token.test.tsx
```

Expected: FAIL. `token.tsx` does not exist; `Metric` still emits `font-mono`.

- [ ] **Step 3: Create the `Token` primitive**

Create `src/components/ui/token.tsx`:

```tsx
import { cn } from '@/lib/utils';

/**
 * A machine token: a string a system produced that a person may need to copy,
 * paste, or quote back. An id, a reference number, a key, a scope, a function
 * name, a status code, a version string.
 *
 * This is the ONLY reason to reach for Geist Mono in feature code. A number the
 * user reads as a quantity, a date, or a time is not a token: that is `Metric`,
 * which renders tabular figures in the sans face. See docs/ui-conventions.md
 * section 3.
 */
export function Token({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn('font-mono', className)}>{children}</span>;
}
```

- [ ] **Step 4: Flip `Metric` to sans**

In `src/components/ui/metric.tsx`, replace the doc comment and drop `font-mono` from the class list, keeping `tabular-nums`:

```tsx
/**
 * Any number the user reads: money, time, duration, count. Geist Sans with
 * tabular figures, so columns line up and digits do not jitter as they tick.
 * Geist Sans with `tabular-nums` measures identically to Geist Mono, so nothing
 * is lost by staying in the body face.
 *
 * A machine token (an id, a key, a scope, an order number) is NOT a Metric: use
 * `<Token>`. See docs/ui-conventions.md section 3.
 *
 * `size="lg"` is the KPI value; the default is the inline 11px meta figure.
 */
```

and change the class list from `'font-mono tabular-nums'` to `'tabular-nums'`.

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run src/components/ui/metric.test.tsx src/components/ui/token.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole suite to see what the flip broke**

```bash
npx vitest run
```

Some snapshot or class-assertion tests may now fail because `Metric` no longer emits `font-mono`. That is expected and correct. For each failure, confirm the only difference is the dropped `font-mono` class, then regenerate snapshots with `npx vitest run -u` or update the assertion. Do NOT regenerate over any other kind of difference. Record every file you touched.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/metric.tsx src/components/ui/token.tsx src/components/ui/metric.test.tsx src/components/ui/token.test.tsx
git commit -m "add the Token primitive and render Metric in tabular sans"
```

Stage any regenerated snapshot files explicitly by path in the same commit.

---

### Task 2: Rewrite the convention

Do this before the migration, so the migration has something to cite.

**Files:**
- Modify: `CLAUDE.md` (hard rule 8, near line 33)
- Modify: `docs/ui-conventions.md` (the numbers rule, near line 76)

**Interfaces:**
- Consumes: the primitives from Task 1.
- Produces: the wording every later task follows.

- [ ] **Step 1: Replace CLAUDE.md rule 8**

It currently reads:

```
8. **Numbers are `<Metric>`.** Geist Mono, tabular, always.
```

Replace with:

```
8. **Numbers are `<Metric>`.** Geist Sans, tabular figures, always. Mono is only for
   machine tokens: ids, reference numbers, keys, scopes, function names, status codes,
   versions. Those are `<Token>`. If a person reads it aloud as a quantity, a date, or
   a time, it is a `<Metric>`, not a token.
```

- [ ] **Step 2: Replace the ui-conventions rule**

It currently reads:

```
**[review]** Every number the user reads is Geist Mono with `tabular-nums`: money, time,
duration, count, id. Use `<Metric>`.
```

Replace with:

```
**[review]** Every number the user reads is Geist Sans with `tabular-nums`: money, time,
duration, count, ratio. Use `<Metric>`. Geist Sans with tabular figures measures
identically to Geist Mono, so a column of `<Metric>` lines up exactly and nothing is
gained by switching face.

**[review]** Mono means one thing: a machine token. A string a system produced that a
person may copy, paste, or quote back. An id, a reference number, a key, a scope, a
function name, a status code, a version. Use `<Token>`. A label is never a token, only
a value can be.

**[ci]** Raw `font-mono` is banned in feature code. Go through `<Token>`.
`src/components/ui` and the PDF and email renderers are exempt: a generated document is
allowed its own typography.
```

- [ ] **Step 3: Check the copy lint still passes**

```bash
npx vitest run src/i18n/copyLint.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/ui-conventions.md
git commit -m "restrict mono to machine tokens in the conventions"
```

---

### Task 3: Migrate Get running, today, dashboard and calendar

The owner named Get running explicitly. These are the highest-visibility surfaces.

**Files:**
- Modify: every `.tsx` under `src/components/getRunning`, `src/components/today`, `src/components/dashboard`, `src/components/calendar`, plus `src/pages/GetRunningPage.tsx`.

**Interfaces:**
- Consumes: `Metric` and `Token` from Task 1, the rule from Task 2.
- Produces: zero raw `font-mono` in those directories except on machine tokens wrapped in `<Token>`.

- [ ] **Step 1: List every site**

```bash
grep -rn "font-mono" src/components/getRunning src/components/today src/components/dashboard src/components/calendar src/pages/GetRunningPage.tsx --include=*.tsx
```

- [ ] **Step 2: Classify and convert each one**

For each site apply this test, in order:

1. **Is it a label rather than a value?** Remove `font-mono` outright. Rule 3.
2. **Would a person copy or quote this into another system?** (an id, a key, a scope, a function name, a status code, a version) Wrap the value in `<Token>` and drop the raw `font-mono`.
3. **Otherwise it is a quantity, a date, or a time.** Remove `font-mono`. If it sits in a column, a table, a meter, or ticks live, ensure `tabular-nums` is present, either by using `<Metric>` or by keeping the `tabular-nums` class.

Known answers in this area, from the audit:

- `getRunning/GetRunningHeader.tsx:109` renders `14 of 16 done`. Quantity in prose. Drop mono, keep `tabular-nums`.
- The hero card's `About 6 minutes`. Quantity in prose. Drop mono.
- Phase step counters `3 / 5` and the phase number circles. Quantities. Drop mono, keep `tabular-nums`.
- `getRunning/panels/airtable/connectSteps.tsx:26-27` renders `data.records:read` and `schema.bases:read`. **Machine tokens. Wrap in `<Token>`.**
- Calendar day headers (`Thu 20 Aug`) and entry times (`19:00`). Dates and times. Drop mono, keep `tabular-nums`.

- [ ] **Step 3: Verify the area is clean**

```bash
echo "raw font-mono left in these dirs (should only be inside token.tsx usage sites you deliberately kept):"
grep -rn "font-mono" src/components/getRunning src/components/today src/components/dashboard src/components/calendar src/pages/GetRunningPage.tsx --include=*.tsx
```

Every remaining hit must be justified in your report, file and line, with the reason it is a machine token.

- [ ] **Step 4: Typecheck, lint and test**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src --max-warnings 0 && npx vitest run
```

Snapshot tests in these areas may need regenerating. Confirm each diff is only the font class before running `npx vitest run -u`.

- [ ] **Step 5: Commit**

```bash
git commit -m "use tabular sans for numbers on the board, today and calendar"
```

---

### Task 4: Migrate the remaining feature areas

**Files:**
- Modify: every remaining `.tsx` under `src/components` and `src/pages` that still has raw `font-mono`, except `src/components/ui`.

**Interfaces:**
- Consumes: the same classification test as Task 3.
- Produces: zero raw `font-mono` in feature code.

- [ ] **Step 1: List what is left**

```bash
grep -rn "font-mono" src --include=*.tsx | grep -v "src/components/ui/"
```

- [ ] **Step 2: Apply the same three-step test from Task 3 Step 2**

Expect most of `src/components/platform`, `src/components/settings/airtable` and `src/components/hireOrders` to KEEP mono, wrapped in `<Token>`, because they are genuinely machine tokens:

- `platform/UserDetailSheet.tsx` user UUID. Token.
- `platform/systemHealth/EdgeFunctionsPanel.tsx` function names and status codes. Token.
- `platform/systemHealth/RecentRunsList.tsx` HTTP status. Token. **But its timestamps are sans**, per the owner's decision.
- `settings/airtable/ReadOnlyBanner.tsx` `configure_airtable` capability key. Token.
- `hireOrders/OrdersTable.tsx` and `OrderSlideOver.tsx` `order_no`. Token. **But the dates beside them are sans**, per the owner's decision.
- The `AppLayout` version pill `v1.17.2`. Token.
- `layout/AppLayout.tsx:325` the impersonation banner email. An address is a machine string. Token.

- [ ] **Step 3: Verify feature code is clean**

```bash
echo "raw font-mono outside ui/ (must be 0):"
grep -rc "font-mono" src --include=*.tsx | grep -v "src/components/ui/" | grep -v ':0' | wc -l
```

Expected: 0.

- [ ] **Step 4: Typecheck, lint and test**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src --max-warnings 0 && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git commit -m "route machine tokens through Token and numbers through Metric"
```

---

### Task 5: Lint the rule so it holds

**Files:**
- Modify: `eslint/ui-conventions.js`

**Interfaces:**
- Consumes: a tree with zero raw `font-mono` in feature code (Task 4).
- Produces: a rule that fails the build on a new raw `font-mono`.

- [ ] **Step 1: Add the rule**

Add to the `no-restricted-syntax` list in `eslint/ui-conventions.js`:

```js
      {
        // Mono means one thing: a machine token. A string a system produced that
        // a person may copy, paste, or quote back. Numbers the user reads as
        // quantities, dates or times are `<Metric>`, which renders tabular
        // figures in the sans face and measures identically to mono, so a column
        // still lines up exactly. src/components/ui is exempt via eslint.config.js,
        // which is where Token itself lives.
        selector: "Literal[value=/\\bfont-mono\\b/]",
        message:
          'Raw font-mono. Mono is only for machine tokens: use <Token>. A number the user reads is <Metric>. See section 3.',
      },
```

- [ ] **Step 2: Confirm lint is clean**

```bash
npx eslint src --max-warnings 0
```

Expected: clean, because Task 4 removed the last raw use.

If it fires, that is a genuine miss from Task 3 or 4. Convert the call site. Do not weaken the rule and do not add a disable comment.

- [ ] **Step 3: Prove the rule fires**

```bash
printf '\nconst probe = "font-mono text-xs";\n' >> src/components/today/TodayEmpty.tsx
npx eslint src/components/today/TodayEmpty.tsx
```

Expected: FAIL, citing the "Raw font-mono" message. Then revert and confirm clean:

```bash
git checkout src/components/today/TodayEmpty.tsx
npx eslint src/components/today/TodayEmpty.tsx
git status --short
```

- [ ] **Step 4: Commit**

```bash
git add eslint/ui-conventions.js
git commit -m "ban raw font-mono in feature code"
```

---

### Task 6: Verify in the running app

**Files:**
- None modified. Verification only.

- [ ] **Step 1: Boot and open the app**

```bash
npm run local:up
```

Start the dev server through the Browser pane preview (configuration `dev`). **Restart it if it was already running**: a stale Vite process caches the Tailwind config and will show you the old CSS. This cost an hour on the radius work.

- [ ] **Step 2: Confirm Get running has no stray mono**

Navigate to `/get-running` and run in the page:

```js
(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (!/Geist Mono/i.test(getComputedStyle(el).fontFamily || '')) continue;
    if (el.querySelector('*')) continue;
    const t = (el.textContent || '').trim();
    if (t) out.push(t.slice(0, 40));
  }
  return JSON.stringify({ path: location.pathname, count: out.length, samples: out }, null, 2);
})();
```

Expected: the only remaining mono strings are machine tokens. Before this plan the list was:
`v1.17.2`, `14 of 16 done`, `About 6 minutes`, `3 / 5`, `6 / 6`, `5 / 5`, `2 / 5`, several bare counts, and `data.records:read` / `schema.bases:read`.
After, it must contain **no** counters, ratios, durations or bare numbers. `data.records:read` and `schema.bases:read` may remain. The `v1.17.2` pill may remain.

- [ ] **Step 3: Confirm alignment did not regress**

Numbers that sit in columns must still line up. In the page:

```js
(() => {
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.querySelector('*')) continue;
    const t = (el.textContent || '').trim();
    if (!/^[\d.,:\/ ]+$/.test(t) || t.length < 2) continue;
    const cs = getComputedStyle(el);
    if (!/tabular-nums/.test(cs.fontVariantNumeric) && !/Geist Mono/i.test(cs.fontFamily)) {
      bad.push({ text: t.slice(0, 24), cls: String(el.className).slice(0, 60) });
    }
  }
  return JSON.stringify({ count: bad.length, sample: bad.slice(0, 10) }, null, 2);
})();
```

Any hit is a number that lost its tabular figures. Fix it, then re-run.

- [ ] **Step 4: Screenshot Get running in light and dark**

Compare against the pre-change screenshots. Only the typeface of numbers should change. Nothing should reflow or shift, because tabular sans and mono have the same advance width.

- [ ] **Step 5: Confirm the exempt renderers were left alone**

```bash
grep -rc "font-mono\|Geist Mono\|GeistMono" src/lib/hireOrders/pdf supabase/functions/_shared/transactional-email-templates 2>/dev/null | grep -v ':0' || echo "no mono in the document renderers"
```

Whatever this reports must be unchanged from before the plan. A generated PDF or email is a document and keeps its own typography.

- [ ] **Step 6: Run the full gate**

```bash
npm run verify:fast
```

Expected: all nine layers pass.

---

## Self-Review

**Spec coverage.** All five owner decisions are carried: step counters, KPI numbers, hire order dates, money, and system health timestamps are each named explicitly in Task 3 or Task 4 as sans. The owner's "not on Get running's top level" is Task 3, verified in Task 6 Step 2. The "documents and technical specifications" half of their criterion is honoured two ways: machine tokens keep mono via `Token` (Task 4), and the PDF and email renderers are left untouched and confirmed so (Task 6 Step 5).

**Placeholder scan.** No TBDs. Task 3 and Task 4 deliberately give a three-step classification test rather than a regex, because this migration needs per-site judgment; both tasks list the known answers for their area so the judgment is anchored, and both require every surviving `font-mono` to be justified by file and line in the report.

**Type consistency.** `Metric` keeps its existing `size` prop and its three values. `Token` takes only `className` and `children`, matching how it is used in Tasks 3 and 4. The class assertions in Task 1's tests match the class lists written in Steps 3 and 4.

**Known risk.** Task 1 Step 6 regenerates snapshots after removing `font-mono` from `Metric`. The radius work hit exactly this and the guard is the same: confirm the diff is only the font class before regenerating. A snapshot regenerated over a real regression is invisible afterwards.
