# UI Components Standardization (Wave 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the ratified UI conventions foundation from the "UI conventions handoff": 8 new `src/components/ui` primitives, 3 patched primitives (Button, Badge, Card), the ADR + conventions doc + CLAUDE block, and the copy-lint conventions test, migrating every call site the patches break to a green typecheck.

**Architecture:** Additive first (docs, tokens-consuming primitives), then the three breaking primitive patches with their call-site migrations. The ESLint enforcement rules ship as a file but are deliberately NOT wired into the CI gate this wave, because the repo's `--max-warnings 0` gate would fail on ~1,000 pre-existing violations across 205 files. That sweep is Wave 2.

**Tech Stack:** React 18 + TypeScript 5, Tailwind v3 + shadcn/ui (CVA), Vitest + @testing-library/react, ESLint flat config (`eslint.config.js`), react-i18next.

**Spec:** The handoff package itself is the spec. Its canonical documents are committed by Task 1:
- `docs/adr/0012-ui-conventions.md` (the decision record)
- `docs/ui-conventions.md` (the enforceable spec)

The handoff source files live in this session's scratchpad at
`/private/tmp/claude-501/-Users-stefanschaal-Claude-Code-showflow-pro--claude-worktrees-artist-help-faq-navbar-d1f920/c26ece6d-7ae7-449a-98b6-0e5c3ba010e1/scratchpad/ui-std/handoff/`.
Every file's full content is also inlined in this plan, so the plan is self-contained if the scratchpad is gone.

## Global Constraints

- **Source of truth is `src/`** (running app), never `Design System/` (brand history). ADR 0012, decision D0.
- **Tokens only in feature code.** No raw hex, no `rgba()`, no `text-[Npx]`, no `rounded-[Npx]`, no bracket alpha OUTSIDE `src/components/ui`. Inside `src/components/ui` raw values ARE allowed (that is where the primitives resolve tokens). All new primitive files in this plan live in `src/components/ui`, so their bracketed values are legal.
- **13px is the control size.** Buttons, inputs, table cells, nav rows are 13. 14 is body. 11 is the eyebrow/badge.
- **Status colour comes from `TONES`.** Amber (`waiting`) means waiting on a human; red (`risk`) means risk. They are distinct (D3).
- **No dashes in copy** (em or en), no exclamation marks, no emoji, in EN and DE. German is Du-form. Enforced by `src/i18n/copyLint.test.ts` (existing) + `copyLint.conventions.test.ts` (added in Task 8).
- **Plain language in the UI, domain terms in code** (D10). User reads "Waiting on you"; identifier stays `hold`.
- **These tokens already exist** and MUST be used as-is (verified in the repo): `--green-100/500/600`, `--amber-100/500/600`, `--red-100/500/600`, `--accent-50`, `--accent-200`, `--accent-500`, `--accent-text`, `text-accent-text`, `accent-text`, `shadow-elev1/2/3`, radius scale `rounded-xs|s|m|l|xl|xxl|pill`.
- **Do NOT edit** `src/integrations/supabase/types.ts` or `supabase/migrations/**` (irrelevant here, stated for safety).
- **Verify before claiming done:** `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` must all pass at the end (Task 10).
- **Branch:** work stays on the current branch `claude/ui-components-standardization-86477a`. Do not open a PR or merge without the owner's explicit approval (repo ruleset requires a human review approval).

---

## File Structure

**Created (verbatim from handoff, live in `src/components/ui`, bracket values legal here):**
- `src/components/ui/tones.ts` — the single status tone map (`TONES`, `Tone`).
- `src/components/ui/eyebrow.tsx` — `Eyebrow` (only sanctioned uppercase label).
- `src/components/ui/status-dot.tsx` — `StatusDot` (6px square; `bar` variant).
- `src/components/ui/status-pill.tsx` — `StatusPill` (Badge + dot, tone-driven).
- `src/components/ui/metric.tsx` — `Metric` (mono tabular numbers).
- `src/components/ui/count-chip.tsx` — `CountChip`.
- `src/components/ui/kpi-tile.tsx` — `KpiTile`.
- `src/components/ui/page-header.tsx` — `PageHeader`.
- `src/components/ui/empty-state.tsx` — `EmptyState` (discriminated union `action | reason`).
- `docs/adr/0012-ui-conventions.md`
- `docs/ui-conventions.md`
- `eslint/ui-conventions.js` (unwired this wave)
- `src/i18n/copyLint.conventions.test.ts`

**Created (tests, this plan's own — the handoff ships no primitive tests):**
- `src/components/ui/status-pill.test.tsx`
- `src/components/ui/empty-state.test.tsx`

**Modified:**
- `src/components/ui/button.tsx` — replace body with the patched version (remove `link`, narrow `ghost` to icon-only at the type level, move svg sizing into size variants).
- `src/components/ui/badge.tsx` — replace body with the patched version (`risk` → red, `hold` deprecated alias, `waiting`/`tone` added, `StatusDot` for the dot).
- `src/components/ui/card.tsx` — replace body with the patched version (`elevation` prop, default no shadow, symmetric padding, `rounded-l`).
- `CLAUDE.md` — prepend the UI conventions block.
- `eslint.config.js` — add a commented Wave-2 hook pointing at `eslint/ui-conventions.js` (no active rules).
- ~7 files using `variant="link"` on `Button` — migrate.
- ~68 files/sites using a ghost `Button` with a text label — migrate.
- Up to ~7 `CardContent` sites that compensate with `pt-6`; a judgment subset of the 98 `<Card>` sites that sit on a non-white ground get `elevation={2}`.
- `src/i18n/locales/**` — reconcile 7 copy strings (4 exclamations, 3 "Blocked dates" sentences) OR narrow one assertion in the new test.

---

## Task 1: Design artifacts (ADR, conventions doc, CLAUDE block)

No code risk. Pure documentation. Do this first so later PRs/tasks can cite it.

**Files:**
- Create: `docs/adr/0012-ui-conventions.md`
- Create: `docs/ui-conventions.md`
- Modify: `CLAUDE.md` (prepend a section)

**Interfaces:**
- Consumes: nothing.
- Produces: the cited spec that CLAUDE.md and the ESLint messages point at.

- [ ] **Step 1: Create `docs/adr/0012-ui-conventions.md`** with exactly this content:

```markdown
# 12. UI component conventions and their enforcement

Date: 2026-08-21

## Status

Accepted

## Context

The app ships 517 component files over 54 `src/components/ui` primitives and a complete
token set in `src/index.css`. The tokens are sound. The drift is above them: patterns
that are repeated across features without ever becoming a component, and primitives that
are reimplemented locally because the shared one was slightly wrong.

A review found 13 such patterns. The most expensive were an eyebrow label written four
different ways in about 25 files, a status pill with four independent tone maps, and five
implementations of the same segmented control.

The review also found that the repository contains two conflicting descriptions of the
product. `Design System/` is a brand and spec document describing booking operations for
touring music. `src/` is a bilingual theatre casting product with a CI-enforced copy lint.
Design tooling reads the former by default, which is how outdated conventions kept being
reintroduced.

## Decision

1. `src/` is the single source of truth for conventions. `Design System/` is retained as
   brand history and is no longer a working spec. Any tool or agent surface that reads it
   as a spec must be repointed at `docs/ui-conventions.md`.
2. Every repeated visual pattern gets a primitive in `src/components/ui` before it gets a
   second call site.
3. Conventions that a machine can check are checked by a machine. Conventions that a type
   can express are expressed as a type. Only what survives both is left to review.
4. The eleven decisions listed in `docs/ui-conventions.md` are ratified as written.

## Consequences

- Eight new primitives ship: Eyebrow, StatusPill, StatusDot, KpiTile, EmptyState, Metric,
  CountChip, PageHeader.
- `Button` loses the `link` variant and restricts `ghost` to icon buttons at the type
  level. `Badge` gains a distinct red risk tone. `Card` defaults to no elevation.
- `eslint.config.js` gains a restricted-syntax block that fails on raw hex, bracket type
  sizes, bracket radii and bracket alpha outside `src/components/ui`.
- Feature code becomes shorter and more boring. That is the point.
```

- [ ] **Step 2: Create `docs/ui-conventions.md`** with exactly this content:

```markdown
# UI conventions

This file is the spec. If it disagrees with `Design System/`, this file wins (ADR 0012).
If it disagrees with the code, the code is a bug or this file is stale: fix one of them in
the same PR.

Every rule below is marked with how it is enforced:

- **[ci]** a lint rule or test fails the build
- **[type]** the compiler rejects it
- **[review]** a human blocks the PR

---

## 1. Use the primitive

**[review]** If it exists in `src/components/ui`, use it. Passing `className` to adjust it
is fine. Reimplementing it locally is not.

**[review]** A new visual pattern is a PR against `src/components/ui` first, then a call
site. Never the other way round.

## 2. Tokens

**[ci]** No raw hex, no `rgba()`, no bracket sizes in a feature component. Tokens only.
Outside `src/components/ui` the lint fails on `#rrggbb`, `text-[Npx]`, `rounded-[Npx]`
and bracket alpha.

**[review]** Radii use the design-system scale (`xs s m l xl xxl pill`). The shadcn
aliases `rounded-sm`, `rounded-md` and `rounded-lg` are retired.

**[review]** Radii nest inward. A card at 10 holds a button at 8 holds a chip at 4. Never
reversed.

**[review]** A hairline carries elevation on the page. Shadow only where the surface
floats above another one.

## 3. Type

The scale is **48 / 32 / 22 / 17 / 14 / 13 / 12 / 11**.

**13 is the control size** (D5). Buttons, inputs, table cells, tabs and nav rows are 13.
14 is body copy. 11 is the eyebrow and the badge.

**[ci]** Half-pixel sizes are gone. 10.5, 11.5, 12.5 and 13.5 do not exist.

**[review]** Every number the user reads is Geist Mono with `tabular-nums`: money, time,
duration, count, id. Use `<Metric>`.

## 4. Color roles

**[review]** One primary button per view. Two violets in a row is a rejected review.

**[review]** Red means risk. It is never emphasis, never a brand accent, never a hover
state. Amber means waiting on a human (D3).

**[review]** Accent text is `text-accent-text`, never `text-accent-700`. The accent scale
is immutable across modes; only the role token flips.

## 5. Components with rules attached

| Component | Rule |
|---|---|
| `Button` | `ghost` is icon only **[type]**. There is no `link` variant **[type]**: a standalone action is `secondary`, an inline reference is an `<a>` (D1, D2). |
| `Badge` | Radius 4, never a pill. Tones come from `TONES`, never from a local map. |
| `Card` | No elevation by default. Pass `elevation="2"` only on a non-white ground. |
| `SegmentedControl` | The only segmented control (D4). `size="sm"` covers what Tabs used to do. |
| `Table` | 34px rows, 13px cells, eyebrow header. `numeric` on any numeric column (D6). |
| `EmptyState` | Never renders without an action, or an explicit `reason` prop saying why there is none (D8). |
| `Eyebrow` | The only way to render an uppercase label. |

## 6. Copy

**[ci]** No em dashes, no en dashes, in either language. Use a period, a colon, or the
word "to" in a range (D9). Enforced by `src/i18n/copyLint.test.ts`.

**[ci]** German is Du-form. Formal Sie mid-sentence fails.

**[ci]** No exclamation marks. No emoji.

**[review]** Plain language in the UI, domain terms in code (D10). The user reads
"Waiting on you"; the identifier stays `hold`. `src/i18n/terms.ts` is the glossary and is
the only place a user-facing term is decided.

**[review]** Sentence case everywhere. Uppercase is the eyebrow, and only the eyebrow.

**[review]** Empty states state the fact, then the next action. No apology.

## 7. Icons

**[review]** Lucide only, `currentColor` only. Size follows the control: 14 for small and
inline, 16 default, 18 sidebar nav, 20 empty states and section heroes. 15 is not a size.

## 8. When a rule is wrong

Open a PR against this file with the reasoning. Do not work around it in a feature
component, and do not add a second component that quietly disagrees. That is how the
thirteen findings happened.
```

- [ ] **Step 3: Prepend the UI block to `CLAUDE.md`.** Insert the following block immediately after the first line (the `# CLAUDE.md — Showflow Pro` title) so it sits near the top (agents truncate). Use Edit to place it right before the `> Do **not** put secrets` blockquote:

```markdown
## UI work: read this before writing a component

`docs/ui-conventions.md` is the spec. It wins over `Design System/`, which is brand
history and describes an older product framing (ADR 0012). Do not take conventions,
copy voice or component behaviour from that folder.

Hard rules, in order of how often they are broken:

1. **Check `src/components/ui` first.** 54 primitives exist. If one is close, use it with
   `className`. Do not write a local version. The eight most-reimplemented patterns are
   now primitives too: `Eyebrow`, `StatusPill`, `StatusDot`, `KpiTile`, `EmptyState`,
   `Metric`, `CountChip`, `PageHeader`.
2. **No raw values.** No hex, no `rgba()`, no `text-[13px]`, no `rounded-[10px]`, no
   `bg-foreground/[0.04]` outside `src/components/ui`. The lint fails. Use tokens.
3. **13px is the control size.** Buttons, inputs, table cells, nav rows. 14 is body.
   11 is the eyebrow.
4. **Uppercase text is `<Eyebrow>`.** Never hand-write
   `text-[11px] font-semibold uppercase tracking-[1.6px]`.
5. **Status colour comes from `TONES`.** Never a local tone map. Amber is waiting, red is
   risk.
6. **No dashes in copy.** Em and en dashes fail CI in both languages. Use a period, a
   colon, or "to" for a range. No exclamation marks, no emoji. German is Du-form.
7. **Plain language in the UI, domain terms in code.** The label is "Waiting on you";
   the identifier is `hold`. New user-facing terms go in `src/i18n/terms.ts`.
8. **Numbers are `<Metric>`.** Geist Mono, tabular, always.

If you believe a rule is wrong, change `docs/ui-conventions.md` in the same PR and say so
in the description. Do not route around it.
```

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0012-ui-conventions.md docs/ui-conventions.md CLAUDE.md
git commit -m "docs: add ADR 0012 and UI conventions spec"
```

---

## Task 2: Tone map + Eyebrow + StatusDot + StatusPill

The foundational tone primitives. `StatusPill` and `StatusDot` are the first two that carry logic worth a test.

**Files:**
- Create: `src/components/ui/tones.ts`
- Create: `src/components/ui/eyebrow.tsx`
- Create: `src/components/ui/status-dot.tsx`
- Create: `src/components/ui/status-pill.tsx`
- Test: `src/components/ui/status-pill.test.tsx`

**Interfaces:**
- Consumes: `@/lib/utils` (`cn`), the existing `Badge` primitive (unpatched at this point — that is fine, `StatusPill` uses `variant="tone"` which the Badge patch in Task 6 adds; see note in Step 6).
- Produces:
  - `TONES: Record<Tone, { bg: string; fg: string; dot: string }>` and `type Tone = 'confirmed' | 'waiting' | 'risk' | 'accent' | 'neutral'`.
  - `Eyebrow({ tone?: Tone; section?: boolean; className?; children })`.
  - `StatusDot({ tone: Tone; shape?: 'dot' | 'bar'; className? })`.
  - `StatusPill({ tone: Tone; dot?: boolean; children })`.

> **Ordering note:** `status-pill.tsx` imports `Badge` and renders `<Badge variant="tone">`. The `tone` Badge variant does not exist until Task 6. To keep this task's test green in isolation, the `status-pill.test.tsx` test asserts the tone → class mapping via `TONES`, and Task 6 (Badge patch) lands before Task 10's full verification. `StatusPill` still compiles now because `variant` is typed loosely on the current Badge (`VariantProps`), and an unknown variant string is a runtime no-op, not a type error, until Task 6 tightens nothing here. If `tsc` flags `variant="tone"`, proceed to Task 6 immediately after this task and before running the app.

- [ ] **Step 1: Create `src/components/ui/tones.ts`** with exactly:

```ts
/**
 * The single status tone map. Every badge, pill, dot and eyebrow tint in the app
 * resolves through this record. Adding a tone is a design decision, not a className:
 * if a surface needs a colour that is not here, that is a conversation, not a patch.
 *
 * Amber means a human is being waited on. Red means risk. They are deliberately
 * distinct (ADR 0012, decision D3) after shipping as identical amber for a year.
 */
export const TONES = {
  confirmed: { bg: 'bg-[var(--green-100)]', fg: 'text-[var(--green-600)]', dot: 'bg-[var(--green-500)]' },
  waiting:   { bg: 'bg-[var(--amber-100)]', fg: 'text-[var(--amber-600)]', dot: 'bg-[var(--amber-500)]' },
  risk:      { bg: 'bg-[var(--red-100)]',   fg: 'text-[var(--red-600)]',   dot: 'bg-[var(--red-500)]' },
  accent:    { bg: 'bg-accent-50',          fg: 'text-accent-text',        dot: 'bg-accent-500' },
  neutral:   { bg: 'bg-muted',              fg: 'text-muted-foreground',   dot: 'bg-muted-foreground' },
} as const;

export type Tone = keyof typeof TONES;
```

- [ ] **Step 2: Create `src/components/ui/eyebrow.tsx`** with exactly:

```tsx
import { cn } from '@/lib/utils';
import { TONES, type Tone } from './tones';

/**
 * The uppercase kicker above a title. 11px / 600 / +1.6px tracking, per the type
 * scale. This is the ONLY sanctioned way to render uppercase UI text: before it
 * existed the same label was hand-written four different ways across ~25 files.
 *
 * `section` is the quieter variant used for sidebar and menu group headers
 * (10px / +0.08em), which is a real second size rather than a fifth freehand one.
 */
export function Eyebrow({
  tone = 'neutral',
  section = false,
  className,
  children,
}: {
  tone?: Tone;
  section?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        'm-0 font-semibold uppercase',
        section ? 'text-[10px] tracking-[0.08em]' : 'text-[11px] tracking-[1.6px]',
        TONES[tone].fg,
        className,
      )}
    >
      {children}
    </p>
  );
}
```

- [ ] **Step 3: Create `src/components/ui/status-dot.tsx`** with exactly:

```tsx
import { cn } from '@/lib/utils';
import { TONES, type Tone } from './tones';

/**
 * A 6px filled square. Not a circle: the spec has always called for a square, and
 * four different circle sizes had shipped instead. `shape="bar"` is the rail
 * variant (a 10x4 lozenge), kept as a prop so it stays the same component.
 */
export function StatusDot({ tone, shape = 'dot', className }: { tone: Tone; shape?: 'dot' | 'bar'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 rounded-[2px]',
        shape === 'bar' ? 'h-1 w-2.5' : 'h-1.5 w-1.5',
        TONES[tone].dot,
        className,
      )}
    />
  );
}
```

- [ ] **Step 4: Create `src/components/ui/status-pill.tsx`** with exactly:

```tsx
import { Badge } from './badge';
import { StatusDot } from './status-dot';
import { TONES, type Tone } from './tones';

/**
 * The one status pill. Domain to tone mapping lives at the call site (see
 * HireOrderStatusBadge for the pattern), but the tone to colour mapping lives
 * only in TONES, so "at risk" is the same red on every surface.
 */
export function StatusPill({ tone, dot = false, children }: { tone: Tone; dot?: boolean; children: React.ReactNode }) {
  return (
    <Badge variant="tone" className={`${TONES[tone].bg} ${TONES[tone].fg} border-transparent`}>
      {dot && <StatusDot tone={tone} />}
      {children}
    </Badge>
  );
}
```

- [ ] **Step 5: Write the failing test** `src/components/ui/status-pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusPill } from './status-pill';
import { StatusDot } from './status-dot';
import { TONES } from './tones';

describe('TONES', () => {
  it('keeps waiting amber and risk red as distinct tones (D3)', () => {
    expect(TONES.waiting.bg).toContain('--amber-100');
    expect(TONES.risk.bg).toContain('--red-100');
    expect(TONES.waiting.bg).not.toEqual(TONES.risk.bg);
  });
});

describe('StatusPill', () => {
  it('applies the tone background and foreground classes', () => {
    const { container } = render(<StatusPill tone="risk">At risk</StatusPill>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-[var(--red-100)]');
    expect(el.className).toContain('text-[var(--red-600)]');
  });

  it('renders a dot only when asked', () => {
    const { container: without } = render(<StatusPill tone="confirmed">Confirmed</StatusPill>);
    const { container: with_ } = render(<StatusPill tone="confirmed" dot>Confirmed</StatusPill>);
    expect(without.querySelectorAll('span[aria-hidden="true"]').length).toBe(0);
    expect(with_.querySelectorAll('span[aria-hidden="true"]').length).toBe(1);
  });
});

describe('StatusDot', () => {
  it('is a square (rounded-[2px]), not a circle', () => {
    const { container } = render(<StatusDot tone="neutral" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('rounded-[2px]');
    expect(el.className).not.toContain('rounded-full');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/components/ui/status-pill.test.tsx`
Expected: FAIL — the module imports do not resolve yet if any file was mistyped, or (if the Badge `tone` variant is absent) the pill renders but the class assertions on the dot/tone still hold. If it fails only because `Badge variant="tone"` produces a TS complaint, that is expected; the assertions themselves must pass once Steps 1-4 exist. The point of running now is to confirm the test executes against the real modules.

- [ ] **Step 7: Make it pass.** Files from Steps 1-4 already implement the behavior. Re-run:

Run: `npx vitest run src/components/ui/status-pill.test.tsx`
Expected: PASS (all three describe blocks green).

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/tones.ts src/components/ui/eyebrow.tsx src/components/ui/status-dot.tsx src/components/ui/status-pill.tsx src/components/ui/status-pill.test.tsx
git commit -m "feat(ui): add TONES map, Eyebrow, StatusDot, StatusPill"
```

---

## Task 3: Metric, CountChip, KpiTile, PageHeader

Presentational primitives. A light render test guards the two composed ones (`KpiTile`, `PageHeader`) so a broken import surfaces immediately.

**Files:**
- Create: `src/components/ui/metric.tsx`
- Create: `src/components/ui/count-chip.tsx`
- Create: `src/components/ui/kpi-tile.tsx`
- Create: `src/components/ui/page-header.tsx`

**Interfaces:**
- Consumes: `cn`, `Eyebrow`, `Metric`, `Tone` (from Task 2).
- Produces:
  - `Metric({ size?: 'inline' | 'body' | 'lg'; className?; children })`.
  - `CountChip({ active?: boolean; children })`.
  - `KpiTile({ label: string; value: string; note?: string | null; tone?: Tone; className? })`.
  - `PageHeader({ eyebrow?: string; eyebrowTone?: Tone; title: string; sub?: string; actions?: React.ReactNode })`.

- [ ] **Step 1: Create `src/components/ui/metric.tsx`** with exactly:

```tsx
import { cn } from '@/lib/utils';

/**
 * Any number the user reads: money, time, duration, count, id. Geist Mono with
 * tabular figures so columns of them line up and none of them jitter as they tick.
 * `size="lg"` is the KPI value; the default is the inline 11px meta figure.
 */
export function Metric({
  size = 'inline',
  className,
  children,
}: {
  size?: 'inline' | 'body' | 'lg';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        size === 'lg' && 'text-2xl font-semibold text-foreground',
        size === 'body' && 'text-[13px]',
        size === 'inline' && 'text-[11px]',
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Create `src/components/ui/count-chip.tsx`** with exactly:

```tsx
import { cn } from '@/lib/utils';

/** The small tabular count beside a tab, nav row or filter. Active is the accent tint. */
export function CountChip({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs px-1 font-mono text-[10px] font-semibold tabular-nums',
        active ? 'bg-accent-50 text-accent-text' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Create `src/components/ui/kpi-tile.tsx`** with exactly:

```tsx
import { cn } from '@/lib/utils';
import { Eyebrow } from './eyebrow';
import { Metric } from './metric';
import type { Tone } from './tones';

/**
 * The KPI tile. Uniform 14px padding, no shadow, mono tabular value. Replaces the
 * two divergent implementations (OrdersKpis used Card, SeasonKpis deliberately did
 * not because Card's shadow and asymmetric padding were wrong; Card is now fixed,
 * but the tile is still worth having once).
 */
export function KpiTile({
  label,
  value,
  note,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string;
  note?: string | null;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn('rounded-l bg-card p-[14px]', className)}>
      <Eyebrow tone={tone}>{label}</Eyebrow>
      <p className="mt-1">
        <Metric size="lg">{value}</Metric>
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/ui/page-header.tsx`** with exactly:

```tsx
import { Eyebrow } from './eyebrow';
import type { Tone } from './tones';

/**
 * Eyebrow, H1, sub line, actions. Every page uses it, so the 32px headline and the
 * -0.6px tracking are decided once. Actions are a slot rather than props: the rule
 * that only one of them may be primary is enforced by review, not by the type.
 */
export function PageHeader({
  eyebrow,
  eyebrowTone = 'accent',
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  eyebrowTone?: Tone;
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <Eyebrow tone={eyebrowTone}>{eyebrow}</Eyebrow>}
        <h1 className="m-0 mt-1 text-[32px] font-semibold tracking-[-0.6px]">{title}</h1>
        {sub && <p className="m-0 mt-1.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2 pt-1.5">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck the new files**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (no new errors from these four files).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/metric.tsx src/components/ui/count-chip.tsx src/components/ui/kpi-tile.tsx src/components/ui/page-header.tsx
git commit -m "feat(ui): add Metric, CountChip, KpiTile, PageHeader"
```

---

## Task 4: EmptyState (discriminated union)

The one primitive whose type does real work: it is impossible to render an empty state without either an `action` or a `reason`.

**Files:**
- Create: `src/components/ui/empty-state.tsx`
- Test: `src/components/ui/empty-state.test.tsx`

**Interfaces:**
- Consumes: `cn`, the existing `Button` primitive (unpatched here — `variant="secondary"` is valid in both the old and patched Button), `LucideIcon` type.
- Produces: `EmptyState(props: WithAction | WithReason)` where
  `Base = { title: string; body?: string; size?: 'block' | 'inline'; icon?: LucideIcon; className?: string }`,
  `WithAction = Base & { action: { label: string; onClick: () => void }; reason?: never }`,
  `WithReason = Base & { action?: never; reason: string }`.

- [ ] **Step 1: Write the failing test** `src/components/ui/empty-state.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the block action button and fires onClick', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No orders yet" body="Draft one to get going." action={{ label: 'New order', onClick }} />);
    const btn = screen.getByRole('button', { name: 'New order' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders an inline action as a text button', () => {
    const onClick = vi.fn();
    render(<EmptyState size="inline" title="Nothing here" action={{ label: 'Add one', onClick }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders with a reason and no action', () => {
    render(<EmptyState title="Locked" reason="This module is off for your org." />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ui/empty-state.test.tsx`
Expected: FAIL with a module-not-found error for `./empty-state`.

- [ ] **Step 3: Create `src/components/ui/empty-state.tsx`** with exactly:

```tsx
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Every empty state in the app. The type deliberately makes an empty state without
 * a next action impossible unless you say why: pass `action`, or pass `reason` and
 * explain in the string. State the fact, then the next action.
 *
 * `size="block"` is a page or panel. `size="inline"` is a rail, cell or list.
 */
type Base = { title: string; body?: string; size?: 'block' | 'inline'; icon?: LucideIcon; className?: string };
type WithAction = Base & { action: { label: string; onClick: () => void }; reason?: never };
type WithReason = Base & { action?: never; reason: string };

export function EmptyState(props: WithAction | WithReason) {
  const { title, body, size = 'block', icon: Icon, className, action } = props;

  if (size === 'inline') {
    return (
      <div className={cn('py-2', className)}>
        <p className="m-0 text-[13px] text-muted-foreground">{title}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1.5 text-[13px] font-medium text-accent-text hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-dashed border-border px-8 py-11 text-center', className)}>
      {Icon && (
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="m-0 mt-3.5 text-[22px] font-semibold tracking-[-0.3px]">{title}</p>
      {body && <p className="mx-auto mb-0 mt-2 max-w-[420px] text-[13px] leading-5 text-muted-foreground">{body}</p>}
      {action && (
        <Button variant="secondary" onClick={action.onClick} className="mt-[18px]">
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ui/empty-state.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/empty-state.tsx src/components/ui/empty-state.test.tsx
git commit -m "feat(ui): add EmptyState with action-or-reason type gate"
```

---

## Task 5: Patch Card (elevation prop, symmetric padding)

Visual-only change, no type errors. Default Card loses its shadow; `CardContent` regains top padding.

**Files:**
- Modify: `src/components/ui/card.tsx` (replace whole file)
- Modify: up to ~7 `CardContent` call sites that manually add `pt-6`, and a judgment subset of `<Card>` sites on a non-white ground.

**Interfaces:**
- Consumes: `cn`.
- Produces: `Card` now accepts `elevation?: 0 | 2 | 3` (default `0`). `CardHeader/CardTitle/CardFooter/CardContent/CardDescription` unchanged in signature; `CardContent` padding is now symmetric `p-4`.

- [ ] **Step 1: Replace `src/components/ui/card.tsx`** with exactly:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PATCHED against the shipped card.tsx (ADR 0012, finding 05).
 *
 * The default was `shadow-elev2`, which the system explicitly does not want for a
 * card sitting on the page: a hairline carries the work there. SeasonKpis had opted
 * out of Card entirely because of this, with a source comment explaining why. That
 * comment can now be deleted.
 *
 * Padding is symmetric. CardContent no longer removes its own top padding, which was
 * the reason every call site had to pass `pt-6` back in.
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { elevation?: 0 | 2 | 3 }
>(({ className, elevation = 0, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-l border bg-card text-card-foreground",
      elevation === 2 && "shadow-elev2",
      elevation === 3 && "shadow-elev3",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-4 pb-0", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-[22px] font-semibold leading-none tracking-tight font-display", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

- [ ] **Step 2: Find `CardContent` sites that double-pad.** The old `CardContent` was `p-4 pt-0`; call sites that added `pt-6`/`pt-4` to put the top padding back will now double up. List them:

Run: `grep -rn "CardContent" src --include=*.tsx | grep -E "pt-6|pt-4"`

For each hit, open the file and remove the now-redundant `pt-*` override from the `CardContent` className (leave any that are intentional inner spacing). There are ~7 candidates. This is judgment per site: remove the override only where it was compensating for the old `pt-0`.

- [ ] **Step 3: Identify Cards that need `elevation={2}`.** The default (no shadow) is correct for a Card sitting on the page background. A Card that floats on a non-white ground (inside a dialog, a popover, a nested colored panel) needs `elevation={2}`. Enumerate call sites:

Run: `grep -rn "<Card\b" src --include=*.tsx | grep -vE "/components/ui/"`

You do NOT edit all 98. Add `elevation={2}` ONLY where the Card visually sits above another surface. Verify visually in Task 10's browser step; if unsure, leave default (no shadow) — the conventions doc says a hairline carries elevation on the page, so default-off is the intended look for the majority.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. The `elevation` prop is additive; no call site breaks.

- [ ] **Step 5: Run any existing card-related tests**

Run: `npx vitest run src/components/ui`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/card.tsx $(git diff --name-only | grep -v card.tsx)
git commit -m "feat(ui): Card defaults to no elevation with symmetric padding (ADR 0012)"
```

---

## Task 6: Patch Badge (red risk tone, waiting/tone variants, deprecated hold)

Non-breaking. Adds variants and flips `risk` from amber to red. Existing `variant="hold"` sites keep compiling via the deprecated alias.

**Files:**
- Modify: `src/components/ui/badge.tsx` (replace whole file)

**Interfaces:**
- Consumes: `cn`, `StatusDot` (Task 2).
- Produces: `Badge` variants now include `default | secondary | outline | confirmed | waiting | risk | destructive | accent | neutral | tone | hold`. `risk` and `destructive` are red. `hold` is a deprecated amber alias for `waiting`. `BadgeProps` unchanged (`dot?: boolean`). This is what makes `StatusPill`'s `variant="tone"` (Task 2) valid.

- [ ] **Step 1: Replace `src/components/ui/badge.tsx`** with exactly:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { StatusDot } from "./status-dot";

/**
 * PATCHED against the shipped badge.tsx (ADR 0012).
 *
 *  D3  `risk` was byte-identical to `hold`. It is now red, which is what the system
 *      reserves red for. `hold` is renamed `waiting` to match the shipped vocabulary
 *      in i18n/terms.ts, with `hold` kept as a deprecated alias for one release.
 *      Prefer <StatusPill tone> over these variants in new code.
 *
 * Radius stays 4. Badges are not pills.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0 h-5 text-[11px] font-medium tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "text-foreground",
        confirmed: "border-transparent bg-[var(--green-100)] text-[var(--green-600)]",
        waiting: "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
        risk: "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
        destructive: "border-transparent bg-[var(--red-100)] text-[var(--red-600)]",
        accent: "border-accent-200 bg-accent-50 text-accent-text",
        neutral: "border-border bg-muted text-muted-foreground",
        /** Colour supplied by StatusPill from TONES. */
        tone: "border-transparent",
        /** @deprecated use `waiting` */
        hold: "border-transparent bg-[var(--amber-100)] text-[var(--amber-600)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <StatusDot tone="neutral" className="bg-current" />}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. No call site referenced a variant that was removed (none were removed).

- [ ] **Step 3: Run the primitive tests (StatusPill now fully valid)**

Run: `npx vitest run src/components/ui/status-pill.test.tsx src/components/ui/badge.test.tsx 2>/dev/null || npx vitest run src/components/ui/status-pill.test.tsx`
Expected: PASS.

- [ ] **Step 4: Grep for any local amber `risk` assumption that this flip breaks visually.** `risk` was amber and is now red. Any test or snapshot asserting `risk` is amber must update:

Run: `grep -rn "risk" src --include=*.tsx --include=*.ts | grep -iE "amber|--amber"`
Fix any that hardcode the old amber expectation. Expected: none (the tone lived only in badge.tsx).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/badge.tsx
git commit -m "feat(ui): Badge gains red risk tone, waiting/tone variants, deprecated hold (ADR 0012)"
```

---

## Task 7: Patch Button + migrate every breaking call site

The one type-breaking task. Applying the patch turns off `variant="link"` (7 sites) and restricts `ghost` to `size="icon"` (68 text-ghost sites). This task is NOT green until every one is migrated. Treat "`tsc` clean" as the task's single test.

**Files:**
- Modify: `src/components/ui/button.tsx` (replace whole file)
- Modify: 6 files with 7 `variant="link"` usages.
- Modify: ~68 sites across ~50 files with ghost-with-text buttons.

**Migration rules (from D1/D2, owner-confirmed):**
- **`variant="link"` → depends on role:**
  - A *standalone action* (it does something: resend, sync, discard) → `variant="secondary"` (keep it small with `size="sm"` if it was sm; drop any `p-0 h-auto` link styling — a secondary button has its own box).
  - An *inline reference inside prose* (navigates/links, reads as a word in a sentence) → replace the `<Button>` with an `<a>` (or a plain `<button>` styled as a link) using `className="text-[13px] font-medium text-accent-text hover:underline"`. Prefer this ONLY when the element truly reads as inline text; otherwise use secondary.
- **`ghost` with a text label → depends on role:**
  - A *standalone action* (Cancel, Discard, Apply, Reset in a toolbar/footer) → `variant="secondary"`.
  - An *inline low-emphasis reference* (a "show more", a muted "copy" that reads as a link) → an accent-text link: replace with `<button type="button" className="text-[13px] font-medium text-accent-text hover:underline" onClick=...>` (or `<a>` if it navigates). Keep the existing `onClick`/`disabled`/`aria-*`.
  - Preserve every existing `onClick`, `disabled`, `type`, `aria-label`, `data-testid`. Drop only ghost-specific size hacks that no longer make sense (e.g. `h-6 px-2 text-xs` on something that is now `secondary` — keep sizing if it still reads correctly, else use `size="sm"`).
- **`ghost` + `size="icon"` → leave unchanged.** These 30 are legal under the patched type.

- [ ] **Step 1: Replace `src/components/ui/button.tsx`** with exactly:

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * PATCHED against the shipped button.tsx. Two changes, both from ADR 0012:
 *
 *  D1  The `link` variant is gone. A standalone action is a real button; an inline
 *      reference inside a sentence is an <a>, which is what it always was.
 *  D2  `ghost` is icon only, enforced by the prop type below. A ghost button with a
 *      text label is invisible on a matching surface, but ghost is load-bearing for
 *      the chrome icons, so it is narrowed rather than deleted.
 *
 * Also: svg sizing moved out of the base into the size variants, so a 26px sm button
 * no longer forces a 16px icon (finding 12).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-m text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-elev1 hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-card text-foreground border border-border shadow-elev1 hover:bg-muted active:bg-muted/80",
        destructive: "bg-destructive/10 text-destructive border border-destructive/40 hover:bg-destructive/20 active:bg-destructive/30",
        outline: "border border-border bg-background hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
      },
      size: {
        sm: "h-[26px] rounded-m px-2.5 [&_svg]:size-[14px]",
        default: "h-9 px-3 py-2 [&_svg]:size-4",
        lg: "h-10 rounded-m px-5 [&_svg]:size-4",
        icon: "h-7 w-7 rounded-s [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type BaseProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };
type Size = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/** D2: ghost is only reachable with size="icon". Any other pairing fails to compile. */
export type ButtonProps = BaseProps &
  (
    | { variant?: "default" | "secondary" | "destructive" | "outline"; size?: Size }
    | { variant: "ghost"; size: "icon" }
  );

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 2: Run tsc to enumerate the breakage**

Run: `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "error TS" | head -120`
Expected: FAIL. Errors fall into three buckets:
  1. `variant="link"` sites (7) — "link" is no longer assignable.
  2. ghost-with-text sites (68) — the ghost branch requires `size: "icon"`, so a ghost with `size="sm"`/default/no-size fails.
  3. `buttonVariants({ variant: "ghost" })` inside `src/components/ui/pagination.tsx` and `src/components/ui/calendar.tsx` — these call the CVA function, not the typed component, so they do NOT error (verify). If either DOES error, it is because it passes `variant`/`size` through `ButtonProps`; fix by leaving the CVA call as-is (it accepts the untyped `VariantProps`).

- [ ] **Step 3: Migrate the 7 `variant="link"` sites.** They are:
  - `src/components/calendar/surface/CalendarDaySheet.tsx:102` and `:112`
  - `src/components/admin/people/InviteBar.tsx:87` (resend action → `secondary`, `size="sm"`, drop `h-auto p-0`)
  - `src/components/getRunning/panels/airtable/AirtableConnectionSummary.tsx:132` (action → `secondary` `size="sm"`)
  - `src/components/hireOrders/NewOrderWizard.tsx:973`
  - `src/components/shows/date/CockpitRail.tsx:238`
  - `src/components/shows/date/CockpitHeader.tsx:190`

  Open each, read the surrounding intent, and apply the link-migration rule. Worked example (InviteBar resend, a standalone action):

  ```tsx
  // before
  <Button size="sm" variant="link" className="h-auto p-0 text-xs" disabled={resendPendingId === pendingInvite.id} onClick={() => onResend(pendingInvite.id)}>
  // after (standalone action → secondary; keep it compact)
  <Button size="sm" variant="secondary" className="text-xs" disabled={resendPendingId === pendingInvite.id} onClick={() => onResend(pendingInvite.id)}>
  ```

  Worked example (an inline reference that reads as a word in a sentence):

  ```tsx
  // before
  <Button variant="link" onClick={goToSettings}>Airtable settings</Button>
  // after (inline reference → link-styled button)
  <button type="button" onClick={goToSettings} className="text-[13px] font-medium text-accent-text hover:underline">Airtable settings</button>
  ```

- [ ] **Step 4: List every ghost-with-text site to migrate.** Run this classifier to get the exact file:line list (68 expected):

```bash
python3 - <<'PY'
import re, glob
for f in glob.glob('src/**/*.tsx', recursive=True):
    if '/components/ui/' in f: continue
    s = open(f).read()
    for m in re.finditer(r'<Button\b', s):
        i, depth, end = m.start(), 0, None
        j = i
        while j < len(s):
            c = s[j]
            if c=='{': depth+=1
            elif c=='}': depth-=1
            elif c=='>' and depth==0: end=j; break
            j+=1
        if end is None: continue
        tag = s[i:end]
        if 'variant="ghost"' not in tag: continue
        if re.search(r'size=(\"icon\"|\{[^}]*icon[^}]*\})', tag): continue
        line = s[:i].count('\n')+1
        print(f"{f}:{line}")
PY
```

- [ ] **Step 5: Migrate each ghost-with-text site** using the ghost rule from the task header. Process file by file (a subagent per directory cluster is a good unit if using subagent-driven execution). Worked examples:

  Standalone footer/toolbar action → secondary:
  ```tsx
  // src/components/settings/AirtableSyncTab.tsx (Cancel action)
  // before
  <Button variant="ghost" onClick={() => { p.setReplacing(false); p.setAirtableKey(""); }}>{t('manageDialog.token.cancel')}</Button>
  // after
  <Button variant="secondary" onClick={() => { p.setReplacing(false); p.setAirtableKey(""); }}>{t('manageDialog.token.cancel')}</Button>
  ```

  Tiny muted inline reset "link" → accent-text link button:
  ```tsx
  // src/components/settings/templateEditor/CopyFieldControl.tsx (reset)
  // before
  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" aria-label={t("copyField.resetAria", { label: field.label })} onClick={reset}>
    {t("copyField.reset")}
  </Button>
  // after
  <button type="button" className="text-[13px] font-medium text-accent-text hover:underline" aria-label={t("copyField.resetAria", { label: field.label })} onClick={reset}>
    {t("copyField.reset")}
  </button>
  ```

  Destructive-tinted ghost with text (a delete/remove text action) → `variant="destructive"` (it already reads as danger), preserving the intent:
  ```tsx
  // before
  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" ...>Remove</Button>
  // after
  <Button variant="destructive" size="sm" ...>Remove</Button>
  ```

- [ ] **Step 6: Re-run tsc until clean**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (zero errors). Repeat Steps 3-5 until every ghost-with-text and link site is migrated. Do not suppress errors with `@ts-expect-error` or `as any`.

- [ ] **Step 7: Run the full unit suite** (catches any test that rendered a now-changed button)

Run: `npx vitest run`
Expected: PASS. Fix any test that asserted on the old `link`/ghost classes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): Button drops link variant and restricts ghost to icons (ADR 0012)"
```

---

## Task 8: Copy-lint conventions test + reconcile existing strings

Add the new test and fix the 7 strings that would fail it: 4 exclamation marks and 3 "Blocked dates" body sentences.

**Files:**
- Create: `src/i18n/copyLint.conventions.test.ts`
- Modify: the locale JSON files containing the 7 offending strings (under `src/i18n/locales/**`).

**Interfaces:**
- Consumes: `resources` (from `src/i18n/index.ts`), `TERMS` (from `src/i18n/terms.ts`) — both exist.
- Produces: a passing test asserting no exclamation marks, no emoji, no raw domain-term labels in UI copy, and both languages present per term.

- [ ] **Step 1: Reword the 4 exclamation-mark strings** (they violate ADR D9's no-exclamation rule). Find them:

Run: `grep -rn "!" src/i18n/locales --include=*.json | grep -vE "https?://"`

The four are (EN + DE), reword without an exclamation and without a dash, Du-form in German:
  - `No asks waiting on you · great work!` → `No asks waiting on you. Great work.`
  - `Oops! Page not found` → `Page not found`
  - `Keine Anfragen, die auf dich warten · gut gemacht!` → `Keine Anfragen, die auf dich warten. Gut gemacht.`
  - `Hoppla! Seite nicht gefunden` → `Seite nicht gefunden`

Edit each in its locale JSON file (keep the surrounding key/structure; change only the string value). Preserve the existing middot `·` where present per the first item (that is allowed; only dashes/exclamations/emoji are banned).

- [ ] **Step 2: Reword the 3 "Blocked dates" body sentences.** The new test flags any UI string containing the raw label `Blocked date`. These three are legitimate prose, but D10 wants the plain term. Reword to avoid the raw label while keeping meaning (EN + DE variants):

  - `Blocked dates come off the list before anyone books you, so you only hear about dates that work.` → `Dates you block come off the list before anyone books you, so you only hear about dates that work.`
  - `Blocked dates come out of the list your producer books from, and that is where your say goes.` → `Dates you block come out of the list your producer books from, and that is where your say goes.`
  - (the third is a duplicate EN string of the first — reword identically; if a DE equivalent exists, apply the same "Dates you block" → "Von dir blockierte Termine" phrasing, Du-form, no dash.)

  Find them: `grep -rn "Blocked date" src/i18n/locales --include=*.json`

> **Decision recorded:** we reword the prose rather than loosen the test, so the assertion stays strict and cheap. If a future legitimate string must contain a raw term, narrow the assertion then (not now).

- [ ] **Step 3: Create `src/i18n/copyLint.conventions.test.ts`** with exactly:

```ts
import { describe, it, expect } from 'vitest';
import { resources } from './index';
import { TERMS } from './terms';

/**
 * Extends the existing copyLint suite with the rules ratified in ADR 0012. The dash
 * and Du-form checks already live in copyLint.test.ts and are unchanged.
 *
 * These are deliberately cheap and unambiguous. A rule that needs judgement belongs
 * in docs/ui-conventions.md under [review], not here.
 */
const EXCLAMATION = /!/;
const EMOJI = /\p{Extended_Pictographic}/u;

function strings(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (obj && typeof obj === 'object') return Object.values(obj as Record<string, unknown>).flatMap(strings);
  return [];
}

const all = [...strings(resources.en), ...strings(resources.de)];

describe('copy conventions (ADR 0012)', () => {
  it('no exclamation marks', () => {
    for (const s of all) expect(EXCLAMATION.test(s), s).toBe(false);
  });

  it('no emoji', () => {
    for (const s of all) expect(EMOJI.test(s), s).toBe(false);
  });

  it('terms.ts is the only place a user-facing domain term is decided', () => {
    // Any UI string that reproduces a raw domain term verbatim should be going
    // through termLabel() instead. Guards the D10 plain-language decision.
    const raw = ['Tier ladder', 'Response window', 'Blocked date', 'Hire order'];
    const offenders = all.filter((s) => raw.some((r) => s.includes(r)));
    expect(offenders, offenders.join(' | ')).toHaveLength(0);
  });

  it('every term has both languages', () => {
    for (const [key, t] of Object.entries(TERMS)) {
      expect(t.en.length, key).toBeGreaterThan(0);
      expect(t.de.length, key).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Run the new test**

Run: `npx vitest run src/i18n/copyLint.conventions.test.ts`
Expected: PASS. If it fails, the failing string is printed as the assertion label — reword it per Steps 1-2.

- [ ] **Step 5: Run the full i18n suite** to confirm no key-parity/dash regression from the rewordings

Run: `npx vitest run src/i18n`
Expected: PASS (including the existing `copyLint.test.ts` and `keyParity.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/i18n/copyLint.conventions.test.ts src/i18n/locales
git commit -m "test(i18n): add ADR 0012 copy conventions; reconcile 7 strings"
```

---

## Task 9: Ship the ESLint rules file (unwired)

Commit the enforcement rules so Wave 2 can wire them, but do NOT activate them — the repo's `--max-warnings 0` gate would fail on ~1,000 legacy violations.

**Files:**
- Create: `eslint/ui-conventions.js`
- Modify: `eslint.config.js` (add a commented Wave-2 pointer only)

**Interfaces:**
- Consumes: nothing at runtime this wave.
- Produces: `export const uiConventions` — a flat-config object ready to spread into `eslint.config.js` in Wave 2.

- [ ] **Step 1: Create `eslint/ui-conventions.js`** with exactly:

```js
// Merge into eslint.config.js. Run at "warn" for one sprint, then flip to "error".
// Scoped to feature code: src/components/ui is where raw values are allowed to live.

export const uiConventions = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/components/ui/**', 'src/**/*.test.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': [
      'warn',
      {
        selector: "Literal[value=/#[0-9a-fA-F]{6}\\b/]",
        message: 'Raw hex. Use a token: var(--accent-500), text-foreground, bg-muted. See docs/ui-conventions.md section 2.',
      },
      {
        selector: "Literal[value=/\\btext-\\[[0-9.]+px\\]/]",
        message: 'Bracket type size. The scale is 48/32/22/17/14/13/12/11. 13 is the control size. See section 3.',
      },
      {
        selector: "Literal[value=/\\brounded-\\[[0-9]+px\\]/]",
        message: 'Bracket radius. Use rounded-xs|s|m|l|xl|xxl|pill. See section 2.',
      },
      {
        selector: "Literal[value=/\\b(bg|text|border)-[a-z-]+\\/\\[?[0-9.]+\\]?/]",
        message: 'Ad hoc alpha. Use a tint token. Opacity modifiers silently do nothing on the accent scale. See section 2.',
      },
      {
        selector: "Literal[value=/uppercase/]",
        message: 'Uppercase text is <Eyebrow>. Do not hand-roll the eyebrow. See section 5.',
      },
      {
        selector: "Literal[value=/\\brounded-(sm|md|lg)\\b/]",
        message: 'Retired shadcn radius alias. Use the design-system scale: s (6), m (8), l (10). See section 2.',
      },
    ],
    'no-restricted-imports': [
      'warn',
      {
        patterns: [
          {
            group: ['**/Design System/**'],
            message: 'Design System/ is brand history, not a spec. See ADR 0012 and docs/ui-conventions.md.',
          },
        ],
      },
    ],
  },
};
```

- [ ] **Step 2: Add a commented Wave-2 hook to `eslint.config.js`.** Open the file, and near the top (after existing imports) add, commented out so it is inert:

```js
// Wave 2 (ADR 0012): activate UI convention lint AFTER the ~1,000-violation codemod sweep.
// import { uiConventions } from './eslint/ui-conventions.js';
// ...then add `uiConventions` to the exported config array, flipping its rules to 'error'.
```

Do NOT import it live or add it to the config array this wave. The rules stay dormant.

- [ ] **Step 3: Confirm lint still passes unchanged**

Run: `npm run lint`
Expected: PASS with the same warning count as before this task (zero, given `--max-warnings 0`). The new file under `eslint/` is not linted as source; the commented lines add nothing.

- [ ] **Step 4: Commit**

```bash
git add eslint/ui-conventions.js eslint.config.js
git commit -m "chore(lint): add UI conventions rules (dormant, wired in Wave 2)"
```

---

## Task 10: Full verification + visual spot-check

The final gate. Everything the CLAUDE.md build/test section lists must pass, plus a browser look at the two changes with real visual impact (Card shadow, ghost → secondary).

**Files:** none (verification only). Fix-forward into the relevant task's files if something fails.

- [ ] **Step 1: Typecheck all three projects**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.tools.json --noEmit
```
Expected: PASS both. (The Deno edge check is untouched by this wave; skip unless an edge file changed — none should have.)

- [ ] **Step 2: Lint (zero-warning gate)**

Run: `npm run lint`
Expected: PASS. If a migrated call site introduced an inline `text-[13px]`/`text-accent-text` in feature code, note: those are NOT yet gated (rules dormant), so lint still passes — but prefer the primitive where one fits.

- [ ] **Step 3: Full unit suite + coverage**

Run: `npx vitest run`
Expected: PASS. Then confirm the CI-shaped run: `npm run test:coverage` (thresholds must still be met; the new primitives add covered lines).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: PASS (no unresolved imports, no type errors surfaced by the bundler).

- [ ] **Step 5: Browser spot-check.** Start the local dev server and look at the two visual changes.

```
preview_start { name: "<the dev config from .claude/launch.json, or create one for `npm run dev` on port 8080>" }
```
Then, per the verification workflow:
  - A page with KPI cards / Cards on the page background → confirm Cards now read with a hairline and no drop shadow, and do NOT look "flat/broken" (if a Card sits on a nested/colored surface and now looks unlifted, add `elevation={2}` at that site — back to Task 5 Step 3).
  - A dialog or toolbar where a former ghost-text button became `secondary` → confirm the Cancel/Discard/Reset controls read correctly and are not visually heavier than the primary action beside them.
  - `read_console_messages` → no new errors.
  - `computer { action: "screenshot" }` on one KPI surface and one migrated dialog → attach as proof.

- [ ] **Step 6: Final review + summary.** Confirm the branch is coherent: `git log --oneline` shows Tasks 1-9 as discrete commits. Do NOT open a PR or merge — hand back to the owner for approval (repo ruleset requires a human review approval). Summarize what shipped and explicitly name Wave 2 (the ~1,000-violation codemod sweep + `fontSize` tokens + flipping `eslint/ui-conventions.js` on) as the deferred follow-up.

---

## Self-Review (completed during authoring)

**Spec coverage** — every handoff decision maps to a task:
- D0 source of truth → Task 1 (ADR/docs) + Task 9 (Design System import ban, dormant).
- D1 link variant removed → Task 7.
- D2 ghost icon-only → Task 7.
- D3 amber waiting vs red risk → Task 6 (Badge) + Task 2 (TONES).
- D4 SegmentedControl → **out of scope for Wave 1** (the handoff ships no SegmentedControl file; the conventions doc references it as an existing/aspirational primitive). Noted, not built here.
- D5 13px control size → encoded in patched Button/Badge + docs.
- D6 Table density → **out of scope** (no Table patch in the handoff package); documented in the conventions doc only.
- D7 sidebar → `--surface-3` → **out of scope** (no CSS token change in the handoff files); documented in CORRECTIONS.md as design-tool guidance, not a repo change this wave.
- D8 EmptyState → Task 4.
- D9 dashes/exclamations/emoji → Task 8.
- D10 plain language → Task 8 + docs.
- 8 new primitives → Tasks 2-4.
- Button/Badge/Card patches → Tasks 7/6/5.
- ESLint rules → Task 9 (dormant).
- Copy-lint test → Task 8.
- CLAUDE block → Task 1.

**Deliberately deferred to Wave 2:** the ~1,000-violation ESLint sweep, `fontSize` scale tokens in `tailwind.config.ts` (needed so feature code can express 13px without a bracket), and flipping the lint gate on. Also not in the handoff and therefore not built: SegmentedControl (D4), Table density (D6), the `--sidebar-background` → `--surface-3` repoint (D7), and the `--hover-tint`/`--well-tint`/`--accent-tint` token additions (CORRECTIONS §6). These are design-tool/CSS-token changes without shipped files in the handoff; flag for a Wave 2 or a separate token PR.

**Placeholder scan:** no TBD/TODO left in executable steps; every created file's full content is inlined; migration tasks carry the exact rule + discovery command + worked examples + a `tsc`-clean acceptance test.

**Type consistency:** `Tone` union is defined once in `tones.ts` and consumed unchanged by Eyebrow/StatusDot/StatusPill/KpiTile/PageHeader. `ButtonProps` discriminated union in Task 7 matches the `variant`/`size` names used in the migration examples. `Badge variant="tone"` produced in Task 6 is what Task 2's `StatusPill` consumes.
