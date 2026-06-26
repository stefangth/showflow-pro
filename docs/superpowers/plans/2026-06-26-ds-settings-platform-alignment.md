# ShowFlow DS Alignment (settings/platform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the `/settings` and `/platform` UI with the ShowFlow design system by completing the canonical token foundation (Phase A) and closing the real component gaps (Phase B).

**Architecture:** Phase A makes the canonical DS token vocabulary fully resolvable app-wide (additive token block in `src/index.css` + Tailwind shadow extras), and converts the `--accent-*` scale from HSL triplets to literal hex with a lockstep Tailwind rewire. Phase B then aligns shared shadcn primitives and the two pages using Tailwind utilities + the new tokens. The accent scale stays **immutable across light/dark** to avoid the PR #139 contrast regression.

**Tech Stack:** React 18 + TS, Tailwind v3, shadcn/ui, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Accent scale is immutable across modes.** `--accent-50…900` have identical hex in `:root` and `.dark`. Do NOT adopt the DS doc's dark re-pitch of `--accent-600/700`. Dark-mode role shifts live only in semantic tokens (`--sidebar-accent*`, `--primary-hover/active`).
- **`--space-*`, `--ease-*`, `--dur-*`, and the `--radius-xs…pill` t-shirt scale stay CSS-only** — never add them to `tailwind.config.ts` (they would shadow Tailwind's native spacing/easing utilities and resize existing `rounded-xl/2xl` consumers).
- **Do NOT add `red`/`green`/`amber` as Tailwind color names** — that collides with Tailwind's built-in palettes. Consume DS semantic tints via arbitrary values: `bg-[var(--red-100)] text-[var(--red-600)]`.
- **Semantic tokens only in components.** No hardcoded hex in component classes; use the token vars.
- **Local environment is Deno-only — no node/npm/npx.** `vitest`, `npm run build`, and `eslint` run in **CI on the PR**, not locally. Each test step gives a local grep-based sanity check where possible; the vitest assertion is the CI gate.
- **Commit messages:** imperative, lowercase, ≤72 chars.
- **Do not edit** `supabase/migrations/` or `src/integrations/supabase/types.ts` (not touched here anyway).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/index.css` | Token vocabulary (`:root` + `.dark`). Phase A adds canonical tokens; accent stops → hex. | 1, 2 |
| `tailwind.config.ts` | Maps tokens to utilities. Add `elev0/elev4`; rewire `accent.*` to raw `var()`. | 1, 2 |
| `src/styles/tokens.test.ts` | Source-level regression guard for the token contract (CI; locally greppable). | 1, 2 |
| `src/components/ui/badge.tsx` | Tone/`destructive` variants → DS semantic tints; accent variant border fix. | 2, 3 |
| `src/components/ui/badge.test.tsx` | Badge variant render + tint-token assertions. | 3 |
| `src/components/layout/NotificationsList.tsx` | Unread-row wash: drop the broken accent opacity modifier. | 2 |
| `src/components/ui/input.tsx` | 6px radius + hairline border. | 4 |
| `src/components/ui/card.tsx` | 16px padding (`p-4`). | 4 |
| `src/components/ui/{dialog,alert-dialog}.tsx` | Overlay `--veil`; content `shadow-elev4`. | 5 |
| `src/components/ui/alert.tsx` | `destructive` variant → DS red tint. | 5 |
| `src/components/platform/OrganizationsTab.tsx` | Numeric `tabular-nums`; skeleton `--row-h`. | 6 |

---

## Task 1: DS canonical token foundation (additive)

**Files:**
- Modify: `src/index.css` (`:root` and `.dark` blocks — additive, no existing lines changed)
- Modify: `tailwind.config.ts` (add `boxShadow.elev0`, `boxShadow.elev4`)
- Test: `src/styles/tokens.test.ts` (create)

**Interfaces:**
- Produces (consumed by later tasks): CSS custom properties `--surface`, `--surface-2`, `--surface-3`, `--bg`, `--text`, `--text-muted`, `--text-faint`, `--primary-hover`, `--primary-active`, `--shadow-0/4/inset`, `--veil`, `--green/amber/red-{100,500,600}`, `--radius-xs…pill`, `--space-0…10`, `--ease-out/in-out`, `--dur-fast/base/slow`, `--row-h`, `--btn-h`; Tailwind `shadow-elev0`, `shadow-elev4`.

- [ ] **Step 1: Write the failing test** — create `src/styles/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('DS canonical token foundation', () => {
  it('defines neutral aliases', () => {
    for (const t of ['--bg:', '--surface:', '--surface-2:', '--surface-3:', '--text:', '--text-muted:', '--text-faint:']) {
      expect(css, `missing ${t}`).toContain(t);
    }
  });

  it('defines the primitive scales', () => {
    for (const t of ['--radius-l:', '--radius-xs:', '--space-6:', '--ease-out:', '--dur-fast:', '--row-h:', '--btn-h:', '--veil:', '--shadow-4:', '--shadow-inset:', '--primary-hover:', '--primary-active:']) {
      expect(css, `missing ${t}`).toContain(t);
    }
  });

  it('defines the semantic tint tokens', () => {
    for (const t of ['--red-100:', '--red-600:', '--green-100:', '--green-600:', '--amber-100:', '--amber-600:']) {
      expect(css, `missing ${t}`).toContain(t);
    }
  });
});
```

- [ ] **Step 2: Verify it fails**

Run (CI): `npx vitest run src/styles/tokens.test.ts`
Expected: FAIL — tokens not yet defined.
Local sanity (Deno box): `grep -c -- '--surface:' src/index.css` → expect `0` before the edit.

- [ ] **Step 3: Add the `:root` token block.** In `src/index.css`, find the `:root` accent-scale comment line `    /* ── Violet accent scale ── */` and insert this block **immediately before** it:

```css
    /* ── DS canonical tokens (settings/platform alignment) ── */
    /* Primary interactive states — semantic, NOT raw accent stops, so a dark
       role re-pitch can never break button contrast (white text AA on both). */
    --primary-hover:  249 67% 56%;     /* accent-600 */
    --primary-active: 249 53% 45%;     /* accent-700 */

    /* Neutral aliases — bridge canonical DS names to the shadcn neutrals; the
       inner var() re-resolves per element, so these auto-track light/dark. */
    --bg:         hsl(var(--background));
    --surface:    hsl(var(--card));
    --surface-2:  hsl(var(--muted));
    --surface-3:  #EFEDE7;             /* segmented track / neutral badge */
    --text:       hsl(var(--foreground));
    --text-muted: hsl(var(--muted-foreground));
    --text-faint: #8B8A85;

    /* Elevation extras + modal scrim */
    --shadow-0:     none;
    --shadow-4:     0 24px 48px rgba(20, 18, 14, 0.16);
    --shadow-inset: inset 0 0 0 0.5px rgba(20, 18, 14, 0.06), inset 0 1px 0 rgba(20, 18, 14, 0.03);
    --veil:         rgba(20, 18, 14, 0.18);

    /* Semantic tint scale (raw hex). Badge/alert pattern = -100 bg + -600 text.
       -500 is the solid base (white text), intentionally mode-agnostic. */
    --green-500: #16A34A;  --green-600: #157F3D;  --green-100: #E7F5EC;
    --amber-500: #D97706;  --amber-600: #9A6314;  --amber-100: #FCF1DA;
    --red-500:   #DC2626;  --red-600:   #A02323;  --red-100:   #FCEAEA;

    /* Radius scale (concentric). Collision-free t-shirt keys; NOT wired into
       Tailwind (would resize rounded-xl/2xl). */
    --radius-xs:   4px;
    --radius-s:    6px;
    --radius-m:    8px;
    --radius-l:    10px;
    --radius-xl:   14px;
    --radius-xxl:  20px;
    --radius-pill: 999px;

    /* Spacing / motion / density — CSS-only primitives (consume via var(),
       never as Tailwind utilities). */
    --space-0: 0;    --space-1: 2px;  --space-2: 4px;  --space-3: 6px;  --space-4: 8px;
    --space-5: 12px; --space-6: 16px; --space-7: 24px; --space-8: 32px;
    --space-9: 48px; --space-10: 64px;

    --ease-out:    cubic-bezier(.2, .7, .2, 1);
    --ease-in-out: cubic-bezier(.4, 0, .2, 1);
    --dur-fast: 120ms;  --dur-base: 180ms;  --dur-slow: 260ms;

    --row-h: 34px;  --btn-h: 36px;

```

- [ ] **Step 4: Add the `.dark` override block.** In `src/index.css`, find the `.dark` accent comment line `    /* ── Accent scale (unchanged — perceptually stable) ── */` and insert this block **immediately before** it:

```css
    /* ── DS canonical tokens — dark overrides ── */
    --primary-hover:  249 67% 56%;     /* accent-600 — stays dark for white-text AA */
    --primary-active: 249 53% 45%;     /* accent-700 */

    --surface-3:  #24232B;
    --text-faint: #6F6E6A;

    --shadow-0:     none;
    --shadow-4:     0 24px 48px rgba(0, 0, 0, 0.60);
    --shadow-inset: inset 0 0 0 0.5px rgba(255, 255, 255, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.04);
    --veil:         rgba(0, 0, 0, 0.55);

    /* Tints flip on -100/-600 so the pattern stays legible; -500 unchanged. */
    --green-600: #5DD88A;  --green-100: rgba(34, 197, 94, 0.15);
    --amber-600: #F2B23C;  --amber-100: rgba(217, 119, 6, 0.16);
    --red-600:   #F4756F;  --red-100:   rgba(220, 38, 38, 0.18);

```

(Neutral aliases `--bg/--surface/--surface-2/--text/--text-muted` are NOT re-declared here — their `:root` definitions reference `var(--card)` etc., which re-resolve to the dark neutrals automatically.)

- [ ] **Step 5: Add the Tailwind shadow extras.** In `tailwind.config.ts`, change the `boxShadow` block:

```ts
      boxShadow: {
        elev0: "var(--shadow-0)",
        elev1: "var(--shadow-1)",
        elev2: "var(--shadow-2)",
        elev3: "var(--shadow-3)",
        elev4: "var(--shadow-4)",
      },
```

- [ ] **Step 6: Verify the test passes**

Run (CI): `npx vitest run src/styles/tokens.test.ts`
Expected: PASS.
Local sanity (Deno box): `grep -c -- '--surface:\|--space-6:\|--veil:\|--red-100:' src/index.css` → expect ≥ 4.

- [ ] **Step 7: Commit**

```bash
git add src/index.css tailwind.config.ts src/styles/tokens.test.ts
git commit -m "add ds canonical token foundation to index.css"
```

---

## Task 2: Convert accent scale to hex + Tailwind rewire + lockstep fixes

**Files:**
- Modify: `src/index.css` (`:root` and `.dark` accent stops → hex)
- Modify: `tailwind.config.ts` (`accent.50…900` → raw `var()`)
- Modify: `src/components/ui/badge.tsx:29` (accent variant border)
- Modify: `src/components/layout/NotificationsList.tsx:55` (unread wash)
- Test: `src/styles/tokens.test.ts` (extend)

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: `--accent-50…900` are now literal hex; `var(--accent-NNN)` is a usable color; Tailwind `bg-accent-*`/`text-accent-*`/`border-accent-*` resolve via raw `var()`.

- [ ] **Step 1: Extend the guard test** in `src/styles/tokens.test.ts` (append inside the file, after the existing import + `css` const add a tailwind read, and add a new describe block):

```ts
const tw = readFileSync(resolve(process.cwd(), 'tailwind.config.ts'), 'utf8');

describe('accent scale hex conversion', () => {
  it('accent stops are hex, not HSL triplets', () => {
    expect(css).toMatch(/--accent-500:\s*#6E5CF6/i);
    expect(css).not.toMatch(/--accent-500:\s*\d+\s+\d+%\s+\d+%/);
  });

  it('tailwind consumes the accent scale as raw var(), not hsl()', () => {
    expect(tw).not.toMatch(/hsl\(var\(--accent-\d/);
    expect(tw).toMatch(/var\(--accent-500\)/);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run (CI): `npx vitest run src/styles/tokens.test.ts`
Expected: FAIL — accent still triplets / tailwind still `hsl()`.
Local sanity: `grep -- '--accent-500:' src/index.css` → still shows `249 90% 66%`.

- [ ] **Step 3: Convert the `:root` accent block.** Replace the `:root` block (comment + 10 stops) with:

```css
    /* ── Violet accent scale (literal hex — IMMUTABLE across light/dark) ──
       Read directly as colors (var(--accent-500)) AND via Tailwind utilities
       (bg-accent-500 → var(--accent-500)). Never re-pitch a stop per mode;
       dark role shifts live in --primary-hover/active and --sidebar-accent*. */
    --accent-50:  #F4F1FF;
    --accent-100: #E5DEFF;
    --accent-200: #CABBFF;
    --accent-300: #A88EFF;
    --accent-400: #8A6DF6;
    --accent-500: #6E5CF6;
    --accent-600: #5848D8;
    --accent-700: #4738B0;
    --accent-800: #322685;
    --accent-900: #1E175A;
```

- [ ] **Step 4: Convert the `.dark` accent block.** Replace the `.dark` block (comment + 10 stops) with the identical hex stops:

```css
    /* ── Accent scale — IMMUTABLE across modes (identical hex to :root) ── */
    --accent-50:  #F4F1FF;
    --accent-100: #E5DEFF;
    --accent-200: #CABBFF;
    --accent-300: #A88EFF;
    --accent-400: #8A6DF6;
    --accent-500: #6E5CF6;
    --accent-600: #5848D8;
    --accent-700: #4738B0;
    --accent-800: #322685;
    --accent-900: #1E175A;
```

- [ ] **Step 5: Rewire Tailwind accent utilities.** In `tailwind.config.ts`, replace the numbered accent stops (keep `DEFAULT` and `foreground` as `hsl(var(...))` — those reference the separate `--accent`/`--accent-foreground` triplet tokens):

```ts
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          50:  "var(--accent-50)",
          100: "var(--accent-100)",
          200: "var(--accent-200)",
          300: "var(--accent-300)",
          400: "var(--accent-400)",
          500: "var(--accent-500)",
          600: "var(--accent-600)",
          700: "var(--accent-700)",
          800: "var(--accent-800)",
          900: "var(--accent-900)",
        },
```

- [ ] **Step 6: Fix the badge accent-variant border** (opacity modifier breaks on hex). In `src/components/ui/badge.tsx`, change the `accent` variant line:

```tsx
        accent:
          "border-accent-200 bg-accent-50 text-accent-700",
```

- [ ] **Step 7: Fix the notifications unread wash** (opacity modifier breaks on hex). In `src/components/layout/NotificationsList.tsx`, change the unread className (around line 55):

```tsx
                !n.read && 'bg-accent-50 dark:bg-accent-900',
```

- [ ] **Step 8: Verify the guard test passes + no stray accent opacity modifiers remain**

Run (CI): `npx vitest run src/styles/tokens.test.ts`
Expected: PASS.
Local sanity (must print nothing):
```bash
grep -rnE '(bg|text|border|ring|from|to|via|fill|stroke)-accent-[0-9]+/[0-9]+' src/
grep -nE 'hsl\(var\(--accent-[0-9]' tailwind.config.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/index.css tailwind.config.ts src/components/ui/badge.tsx src/components/layout/NotificationsList.tsx src/styles/tokens.test.ts
git commit -m "convert accent scale to hex and rewire tailwind"
```

---

## Task 3: Align badge tone variants to DS semantic tints

**Files:**
- Modify: `src/components/ui/badge.tsx` (`confirmed`/`hold`/`risk`/`destructive` variants)
- Test: `src/components/ui/badge.test.tsx` (create)

**Interfaces:**
- Consumes: `--green/amber/red-{100,600}` (Task 1). Used by `OrganizationsTab` suspended status (`variant="destructive"`) — Task 6 needs no page change for the badge as a result.

- [ ] **Step 1: Write the failing test** — create `src/components/ui/badge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  const variants = ['default','secondary','destructive','outline','confirmed','hold','risk','accent','neutral'] as const;

  it.each(variants)('renders variant=%s without crashing', (variant) => {
    render(<Badge variant={variant}>x</Badge>);
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it('destructive uses the DS red tint pattern', () => {
    render(<Badge variant="destructive">suspended</Badge>);
    const el = screen.getByText('suspended');
    expect(el.className).toContain('var(--red-100)');
    expect(el.className).toContain('var(--red-600)');
  });

  it('confirmed uses the DS green tint, hold the amber tint', () => {
    render(<><Badge variant="confirmed">c</Badge><Badge variant="hold">h</Badge></>);
    expect(screen.getByText('c').className).toContain('var(--green-100)');
    expect(screen.getByText('h').className).toContain('var(--amber-100)');
  });
});
```

- [ ] **Step 2: Verify it fails**

Run (CI): `npx vitest run src/components/ui/badge.test.tsx`
Expected: FAIL — variants still use `bg-success/10` / `bg-destructive`.

- [ ] **Step 3: Update the tint variants.** In `src/components/ui/badge.tsx`, replace the `destructive`, `confirmed`, `hold`, `risk` variant entries:

```tsx
        destructive:
          "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
```
```tsx
        confirmed:
          "border-transparent bg-[var(--green-100)] text-[var(--green-600)]",
        hold:
          "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
        risk:
          "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
```

(Leave `default`, `secondary`, `outline`, `accent`, `neutral` unchanged.)

- [ ] **Step 4: Verify the test passes**

Run (CI): `npx vitest run src/components/ui/badge.test.tsx`
Expected: PASS.
Local sanity: `grep -n 'var(--red-100)\|var(--green-100)\|var(--amber-100)' src/components/ui/badge.tsx` → 4 matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/badge.tsx src/components/ui/badge.test.tsx
git commit -m "align badge tone variants to ds semantic tints"
```

---

## Task 4: Input radius + hairline, card padding

**Files:**
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/card.tsx`
- Test: `src/components/ui/input.test.tsx` (create)

**Interfaces:** none new (pure className polish).

- [ ] **Step 1: Write the failing test** — create `src/components/ui/input.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './input';

describe('Input', () => {
  it('renders with DS radius-s (6px) and a hairline border', () => {
    render(<Input aria-label="field" />);
    const el = screen.getByLabelText('field');
    expect(el.className).toContain('rounded-[6px]');
    expect(el.className).toContain('border-[0.5px]');
  });
});
```

- [ ] **Step 2: Verify it fails**

Run (CI): `npx vitest run src/components/ui/input.test.tsx`
Expected: FAIL — input still `rounded-md border`.

- [ ] **Step 3: Update the input className.** In `src/components/ui/input.tsx`, change `rounded-md border border-border` to `rounded-[6px] border-[0.5px] border-border` (leave the rest of the class string intact):

```tsx
        className={cn(
          "flex h-9 w-full rounded-[6px] border-[0.5px] border-border bg-muted px-3 py-2 text-[13px] shadow-[inset_0_1px_2px_rgba(20,18,14,.03)] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
```

- [ ] **Step 4: Update card padding.** In `src/components/ui/card.tsx`, change `p-3.5` → `p-4` in `CardHeader`, `CardContent`, and `CardFooter` (3 occurrences; keep `pt-0` where present):
  - `CardHeader`: `"flex flex-col space-y-1.5 p-4"`
  - `CardContent`: `"p-4 pt-0"`
  - `CardFooter`: `"flex items-center p-4 pt-0"`

- [ ] **Step 5: Verify the test passes**

Run (CI): `npx vitest run src/components/ui/input.test.tsx`
Expected: PASS.
Local sanity: `grep -n 'rounded-\[6px\] border-\[0.5px\]' src/components/ui/input.tsx` → 1 match; `grep -c 'p-4' src/components/ui/card.tsx` → ≥ 3.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/card.tsx src/components/ui/input.test.tsx
git commit -m "tighten input radius and card padding to ds"
```

---

## Task 5: Dialog/alert-dialog scrim + elevation, alert tint

**Files:**
- Modify: `src/components/ui/dialog.tsx` (overlay + content)
- Modify: `src/components/ui/alert-dialog.tsx` (overlay + content)
- Modify: `src/components/ui/alert.tsx` (`destructive` variant)
- Test: `src/components/ui/alert.test.tsx` (create)

**Interfaces:** Consumes `--veil` (Task 1), `shadow-elev4` (Task 1), `--red-{100,500,600}` (Task 1).

- [ ] **Step 1: Write the failing test** — create `src/components/ui/alert.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Alert, AlertDescription } from './alert';

describe('Alert', () => {
  it('destructive variant uses the DS red tint pattern', () => {
    render(<Alert variant="destructive"><AlertDescription>boom</AlertDescription></Alert>);
    const el = screen.getByRole('alert');
    expect(el.className).toContain('var(--red-100)');
    expect(el.className).toContain('var(--red-600)');
  });
});
```

- [ ] **Step 2: Verify it fails**

Run (CI): `npx vitest run src/components/ui/alert.test.tsx`
Expected: FAIL — destructive still `border-destructive/50 text-destructive`.

- [ ] **Step 3: Update the alert destructive variant.** In `src/components/ui/alert.tsx`, replace the `destructive` variant:

```tsx
        destructive:
          "border-[var(--red-500)] bg-[var(--red-100)] text-[var(--red-600)] [&>svg]:text-[var(--red-600)]",
```

- [ ] **Step 4: Swap the dialog overlay scrim + content elevation.** In `src/components/ui/dialog.tsx`:
  - In `DialogOverlay`, change `bg-black/80` → `bg-[var(--veil)]`.
  - In `DialogContent`, change `shadow-elev3` → `shadow-elev4`.

- [ ] **Step 5: Swap the alert-dialog overlay scrim + content elevation.** In `src/components/ui/alert-dialog.tsx`:
  - In `AlertDialogOverlay`, change `bg-black/80` → `bg-[var(--veil)]`.
  - In `AlertDialogContent`, change `shadow-elev3` → `shadow-elev4`.

- [ ] **Step 6: Verify the test passes**

Run (CI): `npx vitest run src/components/ui/alert.test.tsx`
Expected: PASS.
Local sanity (each must print nothing): `grep -n 'bg-black/80' src/components/ui/dialog.tsx src/components/ui/alert-dialog.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/ui/alert-dialog.tsx src/components/ui/alert.tsx src/components/ui/alert.test.tsx
git commit -m "apply ds veil scrim and elev4 to dialogs and alert"
```

---

## Task 6: OrganizationsTab numerics + skeleton height

**Files:**
- Modify: `src/components/platform/OrganizationsTab.tsx`

**Interfaces:** Consumes `--row-h` (Task 1) and the realigned `destructive` badge (Task 3 — already applied via the existing `variant="destructive"`, no change needed here).

No new test: this is a cosmetic page change (right-aligned tabular numerics, skeleton height). The page's data behavior is unchanged and covered by `src/data/platform` tests; a page-render test here would only assert Tailwind classes against a query-mocked tree at disproportionate cost. Verified visually in Task 7 + CI build.

- [ ] **Step 1: Right-align + tabular-nums on the numeric headers.** In `OrganizationsTab.tsx`, update the three numeric `<TableHead>` cells to `className="text-right"`:

```tsx
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Active artists</TableHead>
            <TableHead className="text-right">Bookings 30d</TableHead>
```

- [ ] **Step 2: Right-align + tabular-nums on the numeric body cells.** Update the three numeric `<TableCell>`s:

```tsx
              <TableCell className="text-right tabular-nums">{o.member_count}</TableCell>
              <TableCell className="text-right tabular-nums">{o.active_artist_count}</TableCell>
              <TableCell className="text-right tabular-nums">{o.bookings_30d}</TableCell>
```

- [ ] **Step 3: Use the DS row height for the loading skeletons.** Change the loading line:

```tsx
  if (isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[34px] w-full" />)}</div>;
```

- [ ] **Step 4: Local sanity check**

```bash
grep -n 'tabular-nums' src/components/platform/OrganizationsTab.tsx   # expect 3
grep -n 'h-\[34px\]' src/components/platform/OrganizationsTab.tsx      # expect 1
```

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/OrganizationsTab.tsx
git commit -m "align organizations table numerics and skeleton height"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite (CI).**

Run (CI / PR): `npx vitest run`
Expected: PASS, including `src/styles/tokens.test.ts`, `badge.test.tsx`, `input.test.tsx`, `alert.test.tsx`, and the existing `button.test.tsx`.

- [ ] **Step 2: Build + lint gate (CI).**

Run (CI / PR): `npm run build` and `npm run lint`
Expected: both succeed. (Cannot run locally — Deno-only box.)

- [ ] **Step 3: Local static audit (Deno box).** All must print nothing:

```bash
grep -rnE '(bg|text|border|ring)-accent-[0-9]+/[0-9]+' src/      # no broken opacity modifiers
grep -nE 'hsl\(var\(--accent-[0-9]' tailwind.config.ts           # tailwind fully rewired
grep -rn 'bg-black/80' src/components/ui/                        # scrims swapped to --veil
```

- [ ] **Step 4: Visual verification on the PR's Vercel preview deploy** (the app can't run locally without node/Vite). Check `/platform` and `/settings` in **light and dark**:
  - `/platform`: suspended org badge is a red **tint** chip (not a solid red pill); numeric columns right-aligned with aligned figures; loading skeletons are row-height (34px).
  - `/settings`: Organization card padding looks even (16px); input has a 6px radius + subtle hairline; the suspend confirmation dialog has the lighter `--veil` scrim + soft elevation.
  - Toggle dark mode: primary buttons stay readable (white text on `#6E5CF6`), the notifications unread row reads as a **subtle** violet tint (if `dark:bg-accent-900` looks too heavy, change it to `dark:bg-[hsl(var(--sidebar-accent))]`), all tint badges legible.

- [ ] **Step 5: No commit** (verification only). Implementation complete — hand off to `superpowers:finishing-a-development-branch` for PR/merge.

---

## Self-Review

**Spec coverage:**
- Accent → hex + Tailwind rewire → Task 2 ✓
- Immutable accent scale (no dark re-pitch) → Global Constraints + Task 2 Steps 3–4 ✓
- Neutral aliases + primitive scales + semantic hex + primary-hover/active + veil/shadow-4 → Task 1 ✓
- Lockstep opacity fixes (badge border, notifications wash) → Task 2 Steps 6–7 ✓
- Badge tint variants → Task 3 ✓
- Input radius/hairline, card padding → Task 4 ✓
- Dialog/alert-dialog veil + elev4, alert tint → Task 5 ✓
- OrganizationsTab numerics + skeleton → Task 6 ✓
- CI-only verification reality + visual check → Task 7 ✓
- Source-level regression guard → Task 1/2 `tokens.test.ts` ✓
- Out-of-scope (button, table, typography, `_ds/`) → not touched ✓

**Placeholder scan:** none — every code step carries full content.

**Type/name consistency:** token names (`--red-100`, `--veil`, `--accent-500`, `shadow-elev4`, `--row-h`) are used identically across tasks; badge variant names match the existing `badgeVariants` keys; the OrganizationsTab `destructive` badge relies on the Task 3 realignment (no name drift).
