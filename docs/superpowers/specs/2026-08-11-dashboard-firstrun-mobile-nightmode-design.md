# Dashboard first-run — mobile & night-mode legibility fix

**Date:** 2026-08-11
**Branch:** `claude/dashboard-mobile-night-mode-ee45e0`
**Approved visual (spec):** https://claude.ai/code/artifact/f2f4f7dc-c3c8-42d3-b67a-adfe648da31d
**Supersedes nothing** — this is a follow-up refinement of the 5c first-run shipped in PR #263.

## Problem

The 5c dashboard first-run surface (`src/components/dashboard/firstRun/*`) does not
scale down and is illegible in night mode. Two independent defects, both purely
presentational:

1. **Night mode — the violet "hot" stage card is dark-on-dark.** The `HOT_*`
   color-mix constants in `StageCard.tsx` mix `var(--surface)`, which is white in
   light mode but `#16151B` (near-black) in dark mode. The hot card background is the
   **immutable** `accent-700` violet (`#4738B0`) in *both* modes, so in dark mode the
   muted text / tag / body / step hints / chips / dividers all compute to near-black on
   violet. Separately, the "Start here" pill and the primary CTA use `bg-card`, which
   flips to near-black in dark under `text-accent-700` (dark violet) → dark-on-dark.

2. **Mobile — the surface never stacks.** The 4-stage chain lays cards out as
   `flex-1 min-w-0` in a single row, so on narrow widths they *squish* to
   one-word-per-line columns instead of stacking or scrolling. `FirstRunHeaderCard`
   (`gap-8` + fixed `w-[264px]` right panel) and `FirstRunSideCard` (fixed `w-[300px]`)
   are horizontal flex rows that never wrap, crushing the left content on a phone.

## Root cause (why night mode specifically)

The 5c component was a faithful port of a reproduction HTML that assumed `--surface`
is always light. ShowFlow's real dark theme redefines `--card`/`--surface` to a dark
value, but the accent scale (`accent-50…900`) is *immutable across modes* by design
(`src/index.css`). Any foreground that must sit on the fixed-violet hot card must
therefore anchor to a **fixed light** value, never to a mode-flipping surface token.

## Approved design

- **Night mode:** anchor the hot card's foreground tints to a fixed light base so the
  card reads as light-on-violet in both themes (light mode stays pixel-identical —
  `--surface` *is* white there, so the swap is a no-op in light). Pills/CTA use the
  immutable `accent-50` light tint instead of the mode-flipping `bg-card`.
- **Mobile (owner decision, 2026-08-11):** the chain **stacks vertically** on narrow
  screens (arrows rotate to point down, preserving the Dates → Offers → Confirm → Hire
  order reading order). Header card and side card stack their two columns. No
  horizontal scroll.
- **Breakpoints** (each component switches to horizontal only when it actually fits;
  `main` is full-width `p-4 sm:p-6` beside the sidebar):
  - Header card + side card (2 columns): horizontal at **`lg`** (≥1024px).
  - 4-stage chain (4 columns): horizontal at **`xl`** (≥1280px); stacked below.

## Implementation (file-by-file)

All changes are className / CSS-variable only. No logic, props, types, or copy change.

### 1. `src/components/dashboard/firstRun/StageCard.tsx` — night mode

- Change the six `HOT_*` constants to anchor on a fixed light base instead of
  `var(--surface)`:
  ```
  const HOT_BASE = "#fff";           // fixed light anchor (was var(--surface))
  const HOT_MUTE = `color-mix(in srgb, ${HOT_BASE} 74%, var(--accent-700))`;
  const HOT_SOFT = `color-mix(in srgb, ${HOT_BASE} 85%, var(--accent-700))`;
  const HOT_LINE = `color-mix(in srgb, ${HOT_BASE} 22%, var(--accent-700))`;
  const HOT_DOT  = `color-mix(in srgb, ${HOT_BASE} 55%, var(--accent-700))`;
  const HOT_CHIPBG  = `color-mix(in srgb, ${HOT_BASE} 20%, var(--accent-700))`;
  const HOT_CHIPBG2 = `color-mix(in srgb, ${HOT_BASE} 14%, var(--accent-700))`;
  ```
- "Start here" pill: `bg-card` → `bg-accent-50` (keep `text-accent-700`).
- Primary CTA button: `bg-card … hover:bg-muted` → `bg-accent-50 … hover:bg-accent-100`.
- Arrow wrapper (responsive, ties into the chain stacking): the leading-arrow `<div>`
  becomes `flex w-full xl:w-[26px] shrink-0 items-center justify-center py-1 xl:py-0
  text-[var(--text-faint)]`, and its `<svg>` gets `rotate-90 xl:rotate-0`.

### 2. `src/components/dashboard/firstRun/DashboardChain.tsx` — chain stacking

- Wrapper: `flex items-stretch gap-0 overflow-x-auto` →
  `flex flex-col xl:flex-row xl:items-stretch gap-0`. (Drop `overflow-x-auto` here;
  the stacked layout never needs horizontal scroll. The parent's own
  `overflow-x-auto` in `DashboardFirstRun.tsx` stays as a safety net for the `xl` row.)

### 3. `src/components/dashboard/firstRun/FirstRunHeaderCard.tsx` — header stacking

- Outer: `flex shrink-0 items-start gap-8 …` →
  `flex shrink-0 flex-col gap-6 lg:flex-row lg:items-start lg:gap-8 …`.
- Right progress panel: `w-[264px] shrink-0` → `w-full lg:w-[264px] lg:shrink-0`.
- Headline: `text-[32px] … leading-[38px]` →
  `text-[26px] leading-[32px] sm:text-[32px] sm:leading-[38px]` (fits a phone).

### 4. `src/components/dashboard/firstRun/FirstRunSideCard.tsx` — side card stacking

- Outer: `flex shrink-0 items-start gap-6 …` →
  `flex shrink-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6 …`.
- Right links panel: `w-[300px] shrink-0` → `w-full lg:w-[300px] lg:shrink-0`.

### 5. `src/components/dashboard/firstRun/FirstRunQueue.tsx` — row wrapping (light touch)

- Queue row: allow the `when` timestamp + CTA to wrap under the title on very narrow
  widths rather than crushing the title: add `flex-wrap` to the row and `ml-auto` on
  the trailing `when`/CTA cluster. Verify in the phone preview; skip if already fine.

## Testing & verification

- **No unit-test changes required.** The existing tests (`StageCard.test.tsx`,
  `firstRunLeaves.test.tsx`, `DashboardFirstRun.test.tsx`) assert text / roles /
  testids / behavior, never class strings or colors, and jsdom does not compute
  styles. They must stay green.
- **Visual = the approved artifact.** The mock is a 1:1 token-faithful reproduction of
  the changed classes; the code change mirrors it.
- **Gates:** `npm run lint` (zero-warning), `npx tsc -p tsconfig.app.json --noEmit`,
  `npx vitest run` (or `npm run test:coverage`).
- **Browser (best-effort):** if the local stack is up, load `/dashboard` in a fresh
  (no-bookings) org, toggle dark mode + a mobile viewport, and screenshot the hot card
  + stacked chain as proof.

## Out of scope

- No changes to the stage-chain composer (`src/lib/dashboard/stageChain.ts`), the
  hooks, copy, gating, or the plain/dim cards' semantic tokens (those already flip
  correctly for dark).
- No changelog / version bump decision here (the 5c PR #263's own 1.15.0→1.16.0 bump is
  a separate owner to-do).
