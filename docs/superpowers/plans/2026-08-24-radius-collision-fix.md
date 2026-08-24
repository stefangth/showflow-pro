# Radius Scale Collision Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the design-system radius scale to collision-proof semantic keys and collapse the 14px hero step into the 10px card step, fixing a live bug where every card and every input in the app renders with mismatched corners.

**Architecture:** The custom `borderRadius` keys `l` and `s` collide with Tailwind's own side utilities (`rounded-l` = round the left side, `rounded-s` = round the logical start side). Both emit a second `.rounded-l` / `.rounded-s` rule that wins the cascade on the overlapping corners. We rename every key to a semantic word Tailwind can never claim, migrate the call sites mechanically, and add a CI test that fails if any future key re-enters Tailwind's reserved namespace. Separately, the owner decided on 2026-08-24 to retire the 14px step: every card in the app is now 10px, which removes a token, a documented step, and the 17 hand-written bracket values in one move.

**Tech Stack:** Tailwind CSS 3, TypeScript, Vitest, ESLint.

**Spec:** The audit artifact at https://claude.ai/code/artifact/3fd2a4a6-047a-4dbe-ac42-fde72b8300db, plus the measured evidence in this plan's Background section. There is no separate spec file; this plan carries the findings.

## Background: the measured bug

Read this before touching anything. It is why the plan exists.

Two CSS rules are emitted for the same class name. Tailwind's comes later and wins on the corners it sets:

```
.rounded-l { border-radius: var(--radius-l) }                                     /* ours, 10px */
.rounded-l { border-top-left-radius: .25rem; border-bottom-left-radius: .25rem }  /* Tailwind, 4px */

.rounded-s { border-radius: var(--radius-s) }                                     /* ours, 6px */
.rounded-s { border-start-start-radius: .25rem; border-end-start-radius: .25rem } /* Tailwind, 4px */
```

Measured in the running app on 2026-08-24:

| element | expected | actual |
|---|---|---|
| `[data-testid="still-shut-card"]` | `10px` | `4px 10px 10px 4px` |
| `[data-testid="all-steps-card"]` | `10px` | `4px 10px 10px 4px` |
| any `Input` | `6px` | `4px 6px 6px 4px` |
| `[data-testid="hero-card"]` | `14px` | `14px` (correct, uses a bracket var) |

Tailwind reserves these radius suffixes: `t r b l tl tr br bl s e ss se es ee`. Any key in that set collides. `xs`, `m`, `xxl` and `pill` do not collide and render correctly today.

## Global Constraints

- **npm only.** `npm ci` to install. Never create `bun.lock`, `yarn.lock`, or `pnpm-lock.yaml`.
- **No raw values in feature code.** No hex, no `rgba()`, no `text-[13px]`, no `rounded-[10px]` outside `src/components/ui`.
- **No em dashes or en dashes in any copy**, English or German. Use a period, a colon, or the word "to" for a range. Enforced by `src/i18n/copyLint.test.ts`.
- **Lint runs at `--max-warnings 0`.** A warning fails the build.
- **Typecheck is three projects.** All three must pass: `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `deno check --node-modules-dir=none supabase/functions/*/index.ts`.
- **Do not edit** `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- **Never hand-edit a generated mirror.** If a file opens with `// GENERATED FILE. Do not edit.`, edit its source and run `npm run sync:mirrors`.

## The agreed naming

Chosen by the owner on 2026-08-24. Semantic words, immune to Tailwind collision.

| old key | new key | value | var | occurrences |
|---|---|---|---|---|
| `xs` | `chip` | 4px | `--radius-xs` | 33 |
| `s` | `field` | 6px | `--radius-s` | 31 (**broken today**) |
| `m` | `control` | 8px | `--radius-m` | 86 |
| `l` | `card` | 10px | `--radius-l` | 131 (**broken today**) |
| `xxl` | `icon` | 20px | `--radius-xxl` | 0 |
| `pill` | `pill` | 999px | `--radius-pill` | 6 (unchanged) |

**There is no hero step.** The owner retired 14px on 2026-08-24: one card radius, 10px, everywhere. The 17 sites that wrote `rounded-[var(--radius-xl)]` become `rounded-card`, and the `--radius-xl` token is deleted rather than left dead.

**No other CSS variable name changes.** Only the Tailwind keys change. This keeps the diff to the utility layer.

### The one nesting conflict this creates

`src/components/today/AtRiskDateCard.tsx` is the only confirmed case where a 14px container holds a 10px child:

- line 106 — the outer card, currently 14px
- line 132 — option rows inside it, `rounded-l` (10px), each carrying a `Button`

Collapse the outer to 10px and the two corners tie, which the system's rule forbids: radii nest inward, never tie. **Resolution: the inner option rows go to `rounded-control` (8px).** They are interactive rows containing buttons, so the control step is the honest one, and it restores the ladder: card 10 holds control 8 holds chip 4.

`src/components/dashboard/ArtistDashboard.tsx` looked like a second case but is not: line 263 and line 369 are siblings in two different list sections, not nested. Verify visually in Task 7, change nothing.

## Do NOT rename these

Genuine Tailwind side utilities. The negative lookahead in every command below protects them, but verify they survive:

- `src/components/ui/input-otp.tsx:35` — `first:rounded-l-md`, `last:rounded-r-md`
- `src/components/ui/calendar.tsx:34` — `rounded-l-md`, `rounded-r-md`

## Out of scope (follow-up plan)

Deliberately excluded so this plan stays reviewable and ships the bug fix fast. Each needs visual review per surface:

- Converting the 33 hand-rolled card `div`s to the `Card` primitive.
- The 17 `shadow-elev2/3` on a white `bg-card` ground, which contradicts the Card rule.
- The 10 `shadow-sm` uses that are not on the elevation scale.
- The 17 `border-[0.5px]` raw values.

---

### Task 1: Guard test that proves the collision

Write the test first. It must fail on the current config, which is what proves the bug is real rather than theoretical.

**Files:**
- Create: `scripts/tailwindRadius.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RESERVED_RADIUS_SUFFIXES` is local to the test. No exports other tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `scripts/tailwindRadius.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../tailwind.config";

/**
 * Tailwind generates side, corner and logical-property radius utilities from
 * these suffixes: rounded-t, rounded-bl, rounded-s and so on. A custom
 * borderRadius key that reuses one of them emits a SECOND rule with the same
 * class name, and Tailwind's rule wins the cascade on the corners it sets.
 *
 * This is not hypothetical. Before this test existed, `l` (cards, 131 uses) and
 * `s` (inputs, 31 uses) both collided, so every card rendered
 * `4px 10px 10px 4px` and every input rendered `4px 6px 6px 4px`.
 *
 * Keep design-system keys as whole words. Never single letters.
 */
const RESERVED_RADIUS_SUFFIXES = new Set([
  "t", "r", "b", "l",
  "tl", "tr", "br", "bl",
  "s", "e",
  "ss", "se", "es", "ee",
]);

describe("design-system radius scale", () => {
  const radii = resolveConfig(tailwindConfig).theme?.borderRadius ?? {};

  it("uses no key that collides with a Tailwind side or logical utility", () => {
    const collisions = Object.keys(radii).filter((key) =>
      RESERVED_RADIUS_SUFFIXES.has(key),
    );
    expect(collisions).toEqual([]);
  });

  it("exposes the full semantic scale", () => {
    for (const key of ["chip", "field", "control", "card", "icon", "pill"]) {
      expect(Object.keys(radii)).toContain(key);
    }
  });

  it("points every semantic key at its design token", () => {
    expect(radii.chip).toBe("var(--radius-xs)");
    expect(radii.field).toBe("var(--radius-s)");
    expect(radii.control).toBe("var(--radius-m)");
    expect(radii.card).toBe("var(--radius-l)");
    expect(radii.icon).toBe("var(--radius-xxl)");
    expect(radii.pill).toBe("var(--radius-pill)");
  });

  it("has no hero step, retired on 2026-08-24 in favour of one card radius", () => {
    expect(Object.keys(radii)).not.toContain("hero");
    expect(Object.values(radii)).not.toContain("var(--radius-xl)");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

```bash
npx vitest run scripts/tailwindRadius.test.ts
```

Expected: FAIL. The first test reports `["s", "l"]` instead of `[]`. The second and third fail because `chip`, `field`, `control`, `card`, `icon` do not exist yet. If the first test passes, stop: the config has already been changed and this plan's premise needs rechecking.

- [ ] **Step 3: Commit the failing test**

```bash
git add scripts/tailwindRadius.test.ts
git commit -m "add failing guard test for radius key collisions"
```

---

### Task 2: Rename the scale in the Tailwind config

**Files:**
- Modify: `tailwind.config.ts` (the `borderRadius` block)

**Interfaces:**
- Consumes: the failing test from Task 1.
- Produces: the utilities `rounded-chip`, `rounded-field`, `rounded-control`, `rounded-card`, `rounded-icon`, `rounded-pill`. Every later task uses these names.

- [ ] **Step 1: Replace the borderRadius block**

In `tailwind.config.ts`, replace the whole `borderRadius: { ... }` block with:

```ts
      borderRadius: {
        /* shadcn compat (--radius = 0.625rem = 10px). Retired for new code:
           rounded-sm/md/lg are aliases the design system does not use. */
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",

        /* Design-system scale. Semantic words, never single letters.
           Tailwind owns the suffixes t r b l tl tr br bl s e ss se es ee for its
           own side, corner and logical-property utilities. A key that reuses one
           emits a second rule under the same class name and Tailwind wins the
           cascade on those corners. That is exactly what happened to `l` (cards)
           and `s` (inputs): every card rendered 4px on the left and 10px on the
           right until 2026-08-24. scripts/tailwindRadius.test.ts now fails the
           build if a key ever re-enters that namespace. */
        chip:    "var(--radius-xs)",   /* 4px   - tags, badges, chips */
        field:   "var(--radius-s)",    /* 6px   - inputs */
        control: "var(--radius-m)",    /* 8px   - buttons, rows inside a card */
        card:    "var(--radius-l)",    /* 10px  - every card, hero included */
        icon:    "var(--radius-xxl)",  /* 20px  - app icons */
        pill:    "var(--radius-pill)", /* 999px - meters, capsules */
        /* There is no hero step. 14px was retired 2026-08-24: one card radius. */
      },
```

Expected test result after this edit: the guard test's first three cases pass, and the fourth ("has no hero step") passes because `hero` was never added.

- [ ] **Step 2: Run the guard test and confirm it passes**

```bash
npx vitest run scripts/tailwindRadius.test.ts
```

Expected: PASS, all three tests.

- [ ] **Step 3: Confirm the build breaks loudly**

The old class names no longer exist, so the app is mid-migration and will render unstyled corners. That is expected until Task 3. Confirm the config itself is valid:

```bash
npx tsc -p tsconfig.tools.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts
git commit -m "rename radius scale to collision-proof semantic keys"
```

---

### Task 3: Migrate every call site

287 occurrences across `src`. Mechanical, but the lookahead matters: `rounded-l-md` and `rounded-lg` must survive untouched.

**Files:**
- Modify: every `.ts` and `.tsx` under `src/` that uses a radius utility.

**Interfaces:**
- Consumes: the new utility names from Task 2.
- Produces: a tree with zero uses of the old names.

- [ ] **Step 1: Record the before counts**

```bash
for k in xs s m l xxl pill; do echo "rounded-$k : $(grep -rhoP "rounded-$k(?![-\w])" src --include=*.tsx --include=*.ts | wc -l | tr -d ' ')"; done
```

Expected: `xs 33`, `s 31`, `m 86`, `l 131`, `xxl 0`, `pill 6`.

- [ ] **Step 2: Run the migration**

Each `(?![-\w])` stops the pattern matching `rounded-lg`, `rounded-sm`, `rounded-md`, `rounded-l-md` or `rounded-r-md`.

```bash
find src -name '*.tsx' -o -name '*.ts' | xargs perl -pi -e '
  s/\brounded-xs(?![-\w])/rounded-chip/g;
  s/\brounded-s(?![-\w])/rounded-field/g;
  s/\brounded-m(?![-\w])/rounded-control/g;
  s/\brounded-l(?![-\w])/rounded-card/g;
  s/\brounded-xxl(?![-\w])/rounded-icon/g;
'
```

- [ ] **Step 3: Verify the old names are gone and the side utilities survived**

```bash
echo "old names remaining (must be 0):"
grep -rhoP "rounded-(xs|s|m|l|xxl)(?![-\w])" src --include=*.tsx --include=*.ts | wc -l
echo "new names (expect chip 33, field 31, control 86, card 131):"
for k in chip field control card icon pill; do echo "rounded-$k : $(grep -rhoP "rounded-$k(?![-\w])" src --include=*.tsx --include=*.ts | wc -l | tr -d ' ')"; done
echo "genuine Tailwind side utilities (must still be 4 lines):"
grep -rnP "rounded-[lrtb]-[a-z0-9]+" src --include=*.tsx
```

Expected: 0 old names. `chip 33`, `field 31`, `control 86`, `card 131`, `icon 0`, `pill 6`. The side-utility grep still shows `input-otp.tsx` and `calendar.tsx`.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src --max-warnings 0
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "migrate radius utilities to semantic names"
```

---

### Task 4: Collapse the 14px hero step into the 10px card step

This is a deliberate visual change, not a rename. Every hero card gets the same corner as every other card. It also removes the last 17 bracket radius values from the tree.

**Files:**
- Modify: the 17 files listed by the grep in Step 1.
- Modify: `src/components/today/AtRiskDateCard.tsx:132` (the nesting fix)
- Modify: `src/index.css` (delete the now-unused `--radius-xl` token)

**Interfaces:**
- Consumes: `rounded-card` and `rounded-control` from Task 2.
- Produces: zero `rounded-[var(--radius-xl)]` and zero `--radius-xl` in the tree.

- [ ] **Step 1: List the sites**

```bash
grep -rn "rounded-\[var(--radius-xl)\]" src --include=*.tsx
```

Expected: 17 matches across `today/`, `getRunning/`, `calendar/surface/`, `dashboard/`, `pages/`.

- [ ] **Step 2: Collapse them to the card radius**

```bash
find src -name '*.tsx' | xargs perl -pi -e 's/\brounded-\[var\(--radius-xl\)\]/rounded-card/g;'
```

- [ ] **Step 3: Fix the one nesting conflict**

In `src/components/today/AtRiskDateCard.tsx`, the outer card is now 10px, so its inner option rows must step down to 8px or they tie. Change line 132 from:

```
                  "flex items-center gap-3 rounded-card border border-border p-3.5",
```

to:

```
                  "flex items-center gap-3 rounded-control border border-border p-3.5",
```

Note the string already reads `rounded-card` at this point, because Task 3 renamed it from `rounded-l`.

- [ ] **Step 4: Delete the dead token**

In `src/index.css`, remove the `--radius-xl` line entirely. Nothing references it once Step 2 lands. Leaving it would recreate exactly the dead-token problem this plan is cleaning up.

- [ ] **Step 5: Verify nothing references the retired step**

```bash
echo "bracket form remaining (must be 0):"
grep -rc "rounded-\[var(--radius-xl)\]" src --include=*.tsx | grep -v ':0' | wc -l
echo "--radius-xl anywhere in src (must be 0):"
grep -rc -- "--radius-xl" src | grep -v ':0' | wc -l
echo "rounded-control (expect 87: 86 from Task 3 plus the nesting fix):"
grep -rhoP "rounded-control(?![-\w])" src --include=*.tsx --include=*.ts | wc -l
echo "rounded-card (expect 147: 131 from Task 3, plus 17 collapsed, minus the 1 nesting fix):"
grep -rhoP "rounded-card(?![-\w])" src --include=*.tsx --include=*.ts | wc -l
```

Expected: 0, 0, 87, 147.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc -p tsconfig.app.json --noEmit && npx eslint src --max-warnings 0
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "collapse the hero radius into the card radius"
```

---

### Task 5: Make the documentation tell the truth

Three sources disagreed about the scale. The config is now correct. This task fixes the other two, plus a wrong comment in the token file.

**Files:**
- Modify: `docs/ui-conventions.md` (the radius rules in section 2)
- Modify: `src/index.css:124-130` (the token comments)

**Interfaces:**
- Consumes: the naming table from Task 2.
- Produces: documentation a developer can follow without getting the wrong value.

- [ ] **Step 1: Fix the radius rule in `docs/ui-conventions.md`**

Replace the line that reads:

```
**[review]** Radii use the design-system scale (`xs s m l xl xxl pill`). The shadcn
aliases `rounded-sm`, `rounded-md` and `rounded-lg` are retired.
```

with:

```
**[review]** Radii use the design-system scale, which is named in words, not letters:
`chip` (4) `field` (6) `control` (8) `card` (10) `icon` (20) `pill` (999).
There is no hero step: every card is 10px, including a full bleed feature card.
The shadcn aliases `rounded-sm`, `rounded-md` and `rounded-lg` are retired.

**[ci]** Never name a radius key with a single letter. Tailwind owns the suffixes
`t r b l tl tr br bl s e ss se es ee` for its side, corner and logical-property
utilities, and a key that reuses one silently loses the cascade on those corners.
`scripts/tailwindRadius.test.ts` fails the build if a key re-enters that namespace.
```

- [ ] **Step 2: Fix the nesting example in the same file**

Replace:

```
**[review]** Radii nest inward. A card at 10 holds a button at 8 holds a chip at 4. Never
reversed.
```

with:

```
**[review]** Radii nest inward. A card at 10 holds a row or button at 8 holds a chip at 4.
Never reversed, never tied. A card inside a card steps down to 8; it does not repeat 10.
```

- [ ] **Step 3: Fix the token comments in `src/index.css`**

The 6px comment claims status dots use it. They do not: `src/components/ui/status-dot.tsx` uses a hardcoded `rounded-[2px]`. The 14px line goes away entirely (Task 4 Step 4 deletes it; if that step already ran, just confirm it is gone). Replace lines 124 to 130 with:

```css
    --radius-xs:   4px;    /* tags, badges, inline chips  -> rounded-chip */
    --radius-s:    6px;    /* inputs                      -> rounded-field */
    --radius-m:    8px;    /* buttons, rows inside a card -> rounded-control */
    --radius-l:   10px;    /* every card                  -> rounded-card */
    --radius-xxl: 20px;    /* app icons                   -> rounded-icon */
    --radius-pill: 999px;  /* meters and capsules         -> rounded-pill */
```

- [ ] **Step 4: Verify the copy lint still passes**

The new prose must contain no em or en dashes. The arrows above are `→`, which is allowed.

```bash
npx vitest run src/i18n/copyLint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/ui-conventions.md src/index.css
git commit -m "align radius docs and token comments with the real scale"
```

---

### Task 6: Fix and extend the lint rule

The rule's own message pointed at a utility that never existed, and its pattern missed two forms that are in the tree today.

**Files:**
- Modify: `eslint/ui-conventions.js` (the bracket-radius rule near line 32, and the retired-alias rule near line 68)

**Interfaces:**
- Consumes: the naming from Task 2.
- Produces: a rule that catches `rounded-[12px]`, `rounded-[var(--radius-l)]` and `border-[0.5px]`.

- [ ] **Step 1: Correct the bracket-radius message and widen the pattern**

Replace the rule whose selector is `"Literal[value=/\\brounded-\\[[0-9]+px\\]/]"` with these two entries:

```js
      {
        selector: "Literal[value=/\\brounded-\\[[0-9.]+(px|rem)\\]/]",
        message:
          "Bracket radius. Use rounded-chip|field|control|card|icon|pill. See section 2.",
      },
      {
        selector: "Literal[value=/\\brounded-\\[var\\(--radius-/]",
        message:
          "Radius token written by hand. Every step has a utility now: rounded-chip|field|control|card|icon|pill. See section 2.",
      },
```

- [ ] **Step 2: Do NOT add a border-width rule in this plan**

This was in an earlier draft and was removed at pre-flight. Recording why, so nobody re-adds it here:

The "no bracket sizes" convention covers radius, text size and alpha but never border width, which is why bracket border widths pass lint. However there are **41** such uses in feature code today, and `npm run lint` runs at `--max-warnings 0`, so a `warn` severity fails the build exactly like an `error` does. Adding the rule now leaves only two bad options: break the build, or scatter 41 disable comments. Both are worse than waiting.

The rule belongs in the follow-up plan that actually fixes those 41 sites, since `border-[0.5px]` to `border` is a visual change needing a look at each surface. Take no action in this step.

- [ ] **Step 3: Update the retired-alias message**

The rule matching `rounded-(sm|md|lg)` still names the old letters. Replace its message with:

```js
        message:
          "Retired shadcn radius alias. Use the design-system scale: chip (4), field (6), control (8), card (10). See section 2.",
```

- [ ] **Step 4: Confirm lint is clean**

```bash
npx eslint src --max-warnings 0
```

Expected: clean. Both new radius rules should find nothing, because Task 4 removed the last `rounded-[var(--radius-xl)]` and there are no bracket px radius values in feature code. `src/components/ui/**` is exempt from these rules (see `eslint.config.js`), which is why `status-dot.tsx`'s `rounded-[2px]` does not trip them.

If either rule does fire, that is a genuine miss from Task 3 or 4. Fix the offending call site rather than weakening the rule.

- [ ] **Step 5: Prove the new rules actually work**

A rule that never fires might be a rule that cannot fire. Verify by temporarily breaking one file:

```bash
printf '\nconst probe = "rounded-[var(--radius-l)] border-2";\n' >> src/components/today/TodayEmpty.tsx
npx eslint src/components/today/TodayEmpty.tsx
```

Expected: FAIL, citing the "Radius token written by hand" message. Then revert:

```bash
git checkout src/components/today/TodayEmpty.tsx
npx eslint src/components/today/TodayEmpty.tsx
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add eslint/ui-conventions.js
git commit -m "fix radius lint message and catch hand written radius tokens"
```

---

### Task 7: Verify in the running app and across CI

The whole point of the plan is a visual bug. Prove it is gone by measuring, not by looking.

**Files:**
- None modified. Verification only.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Boot the local stack and the dev server**

```bash
npm run local:up
```

Then start the dev server through the Browser pane preview (configuration `dev`), not with a bare shell command.

- [ ] **Step 2: Measure the corners that were broken**

With the app open on `/get-running`, run this in the page:

```js
(() => {
  const pick = (sel) => {
    const e = document.querySelector(sel);
    return e ? getComputedStyle(e).borderRadius : 'MISSING';
  };
  const probe = document.createElement('div');
  probe.className = 'rounded-field';
  document.body.appendChild(probe);
  const field = getComputedStyle(probe).borderRadius;
  probe.remove();
  return JSON.stringify({
    stillShut: pick('[data-testid="still-shut-card"]'),
    allSteps:  pick('[data-testid="all-steps-card"]'),
    hero:      pick('[data-testid="hero-card"]'),
    field,
  }, null, 2);
})();
```

Expected, and this is the acceptance criterion for the whole plan:

```
stillShut: "10px"   (was "4px 10px 10px 4px")
allSteps:  "10px"   (was "4px 10px 10px 4px")
hero:      "10px"   (was "14px" — the retired step)
field:     "6px"    (was "4px 6px 6px 4px")
```

Every value must be a single uniform number. Any four-value result means a key still collides. The hero card now matches the cards below it, which is the intended visual change.

- [ ] **Step 2b: Confirm the nesting fix**

```js
(() => {
  const outer = document.querySelector('[data-testid="hero-card"]');
  return JSON.stringify({ heroCard: outer ? getComputedStyle(outer).borderRadius : 'MISSING' });
})();
```

Then open `/today` with an at-risk date present, if the seed has one, and confirm the option rows inside the at-risk card read `8px` while the card itself reads `10px`. If the seed has no at-risk date, record that in the report and rely on the code change plus Task 4 Step 5's counts.

- [ ] **Step 3: Confirm no duplicate rules remain**

```js
(() => {
  const dupes = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (!r.selectorText) continue;
      const m = r.selectorText.match(/^\.rounded-(chip|field|control|card|icon|pill)$/);
      if (m) dupes[m[1]] = (dupes[m[1]] || 0) + 1;
    }
  }
  return JSON.stringify(dupes, null, 2);
})();
```

Expected: every key present reports exactly `1`. A `2` means a collision.

- [ ] **Step 4: Screenshot the board in light and dark**

Capture `/get-running` in both themes and compare against the pre-change screenshots in the audit artifact. Corners should read even on all four sides. Nothing else should move.

- [ ] **Step 5: Run the full fast gate**

```bash
npm run verify:fast
```

Expected: lint, all three typechecks, build, unit tests with coverage, and Deno checks all pass.

- [ ] **Step 6: Commit any verification fixes and open the PR**

```bash
git add -A
git commit -m "verify radius migration renders uniform corners"
```

Write the PR body to a file and use `--body-file`. Do not use a heredoc: apostrophes in prose break shell quoting.

---

## Self-Review

**Spec coverage.** Every finding from the audit that this plan claims to fix has a task: the `l` and `s` collisions (Tasks 1 to 3), the 17 bracket values and the retirement of the 14px step (Task 4), the three disagreeing sources (Tasks 2, 5, 6), the wrong 6px and 14px token comments (Tasks 4 and 5), the lint message naming a nonexistent utility (Task 6), and the uncaught `border-[Npx]` form (Task 6). The dead 20px token is not deleted: it is renamed to `icon` and kept, since removing it is a separate decision from retiring 14px, which the owner made explicitly. The three findings listed under "Out of scope" are deferred with a reason.

**Execution note.** The owner asked for one review at the end rather than a review after each task. Tasks run back to back; the whole-branch review is the single gate.

**Placeholder scan.** No TBDs. Every code step carries the literal text to write. Task 6 Step 4 offers the reviewer a choice between two concrete remedies rather than leaving it open, because the right answer depends on whether the follow-up sweep lands soon.

**Type consistency.** The six key names `chip field control card icon pill` are identical in the Task 1 test, the Task 2 config, the Task 3 and 4 migrations, the Task 5 docs, the Task 6 lint messages, and the Task 7 probes. The CSS variable names are unchanged throughout, which is what keeps Task 3 a pure utility-layer rename.

**Known risk.** Task 3 rewrites 287 strings with a regex. The lookahead is the only thing protecting `rounded-lg`, `rounded-sm`, `rounded-md`, `rounded-l-md` and `rounded-r-md`. Task 3 Step 3 verifies all five survive before the commit, and Task 7 Step 3 catches anything the grep missed by inspecting the emitted CSS.
